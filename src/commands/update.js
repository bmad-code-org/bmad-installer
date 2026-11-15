import { resolve } from 'node:path'
import { UNIVERSAL_AGENT, agentsHolding, detectContext, sharedFolderHolds } from '../agents.js'
import { BMAD_SKILL, inspectInstall, installedModuleCodes } from '../installed.js'
import { message } from '../messages.js'
import { findModule } from '../modules.js'
import { runPreflight } from '../preflight.js'
import { renderMigrations } from '../report.js'
import { showEnding } from './ending.js'
import { add } from './install-steps.js'
import { selectMigrations, versionsByCode } from './install-plan.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */
/** @typedef {import('./install.js').CommandDeps} CommandDeps */

/**
 * Re-adds every installed module this installer knows, one `skills add <folder> -s '*'` each, to
 * the agents already holding BMad here. `npx skills update` re-adds one skill at a time, a fresh
 * clone each, and picks agents from the folders in the project.
 * `checked` is set when install already ran the preflight checks and hands over to update.
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {{ checked?: boolean }} [context]
 * @returns {Promise<number>}
 */
export async function update(options, deps, context = {}) {
  const { bmadScripts, messages, modules, prompts, runner, skillsCli, cwd } = deps
  if (!context.checked) await runPreflight({ interactive: false, runner, messages })

  const directory = resolve(cwd, options.directory ?? cwd)
  const before = await inspectInstall(directory, skillsCli)
  if (!before.bmadSkillDir) {
    prompts.fail(message(messages, 'nothingToUpdate'))
    return 1
  }

  const agents = agentsToUpdate(deps, directory)
  /** @type {AddResult[]} */
  const failures = []
  /** @type {string[]} */
  let unknown = []
  /** @type {StatusReport | null} */
  let wasInstalled = null
  /** @type {StatusReport | null} */
  let report = null
  let bmadSkillDir = before.bmadSkillDir
  const progress = prompts.startSpinner(message(messages, 'statusSpinner'))
  try {
    wasInstalled = await bmadScripts.status(bmadSkillDir, directory).catch(() => null)
    const codes = wasInstalled ? wasInstalled.modules.map((entry) => entry.module) : installedModuleCodes(before, modules)
    const known = modules.filter((module) => module.always || codes.some((code) => findModule(modules, code) === module))
    unknown = codes.filter((code) => !findModule(modules, code))
    for (const module of known) {
      progress.update(message(messages, 'updatingSpinner', { what: module.name }))
      failures.push(...(await add({ source: module.source, skills: ['*'], label: module.name }, agents, directory, deps)))
    }
    bmadSkillDir = (await inspectInstall(directory, skillsCli)).bmadSkillDir ?? bmadSkillDir
    progress.update(message(messages, 'statusSpinner'))
    report = await bmadScripts.status(bmadSkillDir, directory)
  } finally {
    progress.stop()
  }
  if (unknown.length > 0) prompts.say(message(messages, 'updateNotListed', { modules: unknown.join(', ') }))

  const migrations = selectMigrations(await bmadScripts.migrations(bmadSkillDir), {
    codes: report.modules.map((entry) => entry.module),
    before: versionsByCode(wasInstalled),
    after: versionsByCode(report),
  })
  const migrationText = renderMigrations(migrations, messages)
  if (migrationText) prompts.showNote(migrationText)

  showEnding(deps, { report, failures, directory, updated: true })
  return failures.length === 0 ? 0 : 1
}

/**
 * The agents whose project folder already holds BMad, with `universal` for `.agents/skills`.
 * @param {CommandDeps} deps
 * @param {string} directory
 * @returns {string[]}
 */
function agentsToUpdate(deps, directory) {
  const context = (deps.detect ?? detectContext)(directory)
  const own = agentsHolding(deps.agents, BMAD_SKILL, context)
  const agents = sharedFolderHolds(BMAD_SKILL, context) ? [UNIVERSAL_AGENT, ...own] : own
  return agents.length > 0 ? agents : [UNIVERSAL_AGENT]
}
