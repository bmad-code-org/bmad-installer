import { inspectInstall, installedModuleCodes } from '../installed.js'
import { message } from '../messages.js'
import { moduleName } from '../modules.js'
import { installedLabel } from '../report.js'
import { versionsByCode } from './install-plan.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../installed.js').InstalledState} InstalledState */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */
/** @typedef {{ state: InstalledState, report: StatusReport | null, codes: string[], versions: Record<string, string> }} Existing */

/**
 * @param {CommandDeps} deps
 * @param {string} bmadSkillDir
 * @param {string} projectRoot
 * @returns {Promise<StatusReport>}
 */
export async function statusWithSpinner(deps, bmadSkillDir, projectRoot) {
  const spinner = deps.prompts.startSpinner(message(deps.messages, 'statusSpinner'))
  try {
    return await deps.bmadScripts.status(bmadSkillDir, projectRoot)
  } finally {
    spinner.stop()
  }
}

/**
 * What is already installed in the project, said out loud when there is something.
 * @param {string} directory
 * @param {CommandDeps} deps
 * @returns {Promise<Existing>}
 */
export async function readExisting(directory, deps) {
  const { messages, modules, prompts, skillsCli } = deps
  const state = await inspectInstall(directory, skillsCli)
  const report = state.bmadSkillDir
    ? await statusWithSpinner(deps, state.bmadSkillDir, directory).catch(() => null)
    : null
  const codes = report ? report.modules.map((entry) => entry.module) : installedModuleCodes(state, modules)
  const versions = versionsByCode(report)

  if (state.legacyManifest) prompts.say(message(messages, 'legacyManifest'))
  if (codes.length > 0) {
    const names = codes.map((code) => installedLabel(messages, moduleName(modules, code) ?? code, versions[code]))
    prompts.say([message(messages, 'foundModules'), ...names].join('\n'))
  }
  return { state, report, codes, versions }
}
