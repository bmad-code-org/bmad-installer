import { inspectInstall } from '../installed.js'
import { message } from '../messages.js'
import { runPreflight } from '../preflight.js'
import { renderFailures, renderMigrations } from '../report.js'
import { showEnding } from './ending.js'
import {
  chosenModules,
  moduleCalls,
  repeatCommand,
  selectMigrations,
  versionsByCode,
} from './install-plan.js'
import {
  add,
  announceUpdate,
  chooseAgents,
  pickChoices,
  readExisting,
  resolveDirectory,
} from './install-steps.js'
import { update } from './update.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {import('../run.js').Runner} Runner */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */

/**
 * `terminal`, `agent` and `detect` stand in for the live TTY, coding-agent and file system checks in tests.
 * @typedef {{
 *   runner: Runner,
 *   skillsCli: ReturnType<typeof import('../skills-cli.js').createSkillsCli>,
 *   bmadScripts: ReturnType<typeof import('../bmad-scripts.js').createBmadScripts>,
 *   messages: Record<string, any>,
 *   modules: ModuleDefinition[],
 *   agents: import('../agents.js').Agent[],
 *   detect?: (project: string) => import('../agents.js').DetectContext,
 *   prompts: typeof import('../prompts.js'),
 *   env: NodeJS.ProcessEnv,
 *   cwd: string,
 *   version: string,
 *   terminal?: () => boolean,
 *   agent?: () => Promise<string | null>
 * }} CommandDeps
 */

const TITLE = 'BMad Installer'
const SETUP_NEXT = 'bmad setup'

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @returns {Promise<number>}
 */
export async function install(options, deps) {
  const { bmadScripts, messages, modules, prompts, runner } = deps
  const interactive = !options.yes

  prompts.showIntro(messages, TITLE)
  await announceUpdate(deps)
  await runPreflight({
    interactive,
    runner,
    messages,
    warn: prompts.warn,
    terminal: deps.terminal,
    agent: deps.agent,
  })

  const directory = await resolveDirectory(options, deps, interactive)
  const existing = await readExisting(directory, deps)
  if (existing.codes.length > 0 && interactive && (await prompts.chooseExistingAction(messages)) === 'update') {
    return update({ ...options, directory }, deps, { checked: true })
  }

  const chosen = chosenModules(await pickChoices(options, deps, existing), modules)
  for (const module of chosen) {
    if (module.deprecated) {
      prompts.warn(message(messages, 'deprecatedModule', { module: module.name, reason: module.deprecated }))
    }
  }
  const kept = modules.filter((module) => existing.codes.includes(module.code) && !chosen.includes(module))
  if (kept.length > 0) {
    prompts.warn(message(messages, 'modulesKept', { modules: kept.map((module) => module.name).join(', ') }))
  }

  const agents = await chooseAgents(options, deps, directory, interactive)

  /** @type {AddResult[]} */
  const failures = []
  const progress = prompts.startSpinner(message(messages, 'statusSpinner'))
  /** @type {string | null} */
  let bmadSkillDir = null
  /** @type {StatusReport | null} */
  let report = null
  try {
    for (const call of moduleCalls(chosen, existing.report)) {
      progress.update(message(messages, 'installingSpinner', { what: call.label }))
      failures.push(...(await add(call, agents, directory, deps)))
    }
    bmadSkillDir = (await inspectInstall(directory, deps.skillsCli)).bmadSkillDir
    if (bmadSkillDir) {
      progress.update(message(messages, 'statusSpinner'))
      report = await bmadScripts.status(bmadSkillDir, directory)
    }
  } finally {
    progress.stop()
  }
  if (!bmadSkillDir || !report) {
    prompts.fail(failures.length > 0
      ? renderFailures(failures, messages)
      : message(messages, 'firstInstallNotInProject', { directory }))
    return 1
  }

  const migrations = selectMigrations(await bmadScripts.migrations(bmadSkillDir), {
    codes: chosen.map((module) => module.code),
    before: existing.versions,
    after: versionsByCode(report),
  })
  const migrationText = renderMigrations(migrations, messages)
  if (migrationText) prompts.showNote(migrationText)

  showEnding(deps, { report, failures, directory, agents, repeat: repeatCommand(chosen, agents) })

  return failures.length === 0 && (report.current || report.next === SETUP_NEXT) ? 0 : 1
}
