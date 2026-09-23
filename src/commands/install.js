import { BMAD_SKILL, inspectInstall } from '../installed.js'
import { message } from '../messages.js'
import { runPreflight } from '../preflight.js'
import { renderClosing, renderFailures, renderMigrations, renderModuleMessages, renderStatus } from '../report.js'
import {
  chosenModules,
  memberCalls,
  orderedChoices,
  recordCalls,
  selectMigrations,
  versionsByCode,
} from './install-plan.js'
import {
  announceUpdate,
  createAdds,
  parseTools,
  pickChoices,
  readExisting,
  resolveDirectory,
} from './install-steps.js'
import { statusWithSpinner } from './status.js'
import { update } from './update.js'

/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {import('../run.js').Runner} Runner */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */

/**
 * `terminal` and `agent` stand in for the live TTY and coding-agent checks in tests.
 * @typedef {{
 *   runner: Runner,
 *   skillsCli: ReturnType<typeof import('../skills-cli.js').createSkillsCli>,
 *   bmadScripts: ReturnType<typeof import('../bmad-scripts.js').createBmadScripts>,
 *   messages: Record<string, any>,
 *   modules: ModuleDefinition[],
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
    return update({ ...options, directory }, deps)
  }

  const choices = orderedChoices(await pickChoices(options, deps, existing), modules)
  const chosen = chosenModules(choices, modules)
  for (const module of chosen) {
    if (module.deprecated) {
      prompts.warn(message(messages, 'deprecatedModule', { module: module.name, reason: module.deprecated }))
    }
  }

  /** @type {AddResult[]} */
  const failures = []
  const adds = createAdds({ directory, deps, agents: parseTools(options.tools), pick: interactive && !options.tools })
  const installedSkills = existing.state.skills.map((skill) => skill.name)
  for (const call of recordCalls(chosen, BMAD_SKILL, installedSkills)) {
    const result = await adds.run(call)
    if (!result.landed) return 1
    failures.push(...result.failures)
  }

  const { bmadSkillDir } = await inspectInstall(directory, deps.skillsCli)
  if (!bmadSkillDir) {
    prompts.fail(failures.length > 0
      ? renderFailures(failures, messages)
      : message(messages, 'firstInstallNotInProject', { directory }))
    return 1
  }

  const afterRecords = await statusWithSpinner(deps, bmadSkillDir, directory)
  const members = memberCalls(choices, modules, afterRecords)
  for (const entry of members.unknown) {
    prompts.warn(message(messages, 'bundleSkillUnknown', { module: entry.module, skills: entry.skills.join(', ') }))
  }
  for (const call of members.calls) {
    const result = await adds.run(call)
    if (!result.landed) return 1
    failures.push(...result.failures)
  }

  const report = await statusWithSpinner(deps, bmadSkillDir, directory)
  const migrations = selectMigrations(await bmadScripts.migrations(bmadSkillDir), {
    codes: chosen.map((module) => module.code),
    before: existing.versions,
    after: versionsByCode(report),
  })
  const migrationText = renderMigrations(migrations, messages)
  if (migrationText) prompts.showNote(migrationText)

  prompts.showNote(renderStatus(report, { failures, messages, modules }))
  const moduleText = renderModuleMessages(chosen)
  if (moduleText) prompts.showNote(moduleText)
  prompts.showNote(renderClosing(messages, { directory }))
  prompts.finish('')

  return failures.length === 0 && (report.current || report.next === SETUP_NEXT) ? 0 : 1
}
