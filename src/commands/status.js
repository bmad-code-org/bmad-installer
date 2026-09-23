import { resolve } from 'node:path'
import { inspectInstall } from '../installed.js'
import { message } from '../messages.js'
import { PreflightError, uvInstallCommand, uvVersion } from '../preflight.js'
import { renderStatus } from '../report.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('./install.js').CommandDeps} CommandDeps */
/** @typedef {import('../cli.js').CliOptions} CliOptions */

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
 * @param {CommandDeps} deps
 * @returns {Promise<void>}
 */
async function requireUv(deps) {
  if (await uvVersion(deps.runner) !== null) return
  const installCommand = uvInstallCommand(deps.messages)
  throw new PreflightError(message(deps.messages, 'uvMissing', { installCommand }))
}

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @returns {Promise<number>}
 */
export async function status(options, deps) {
  const { messages, modules, prompts, skillsCli, cwd } = deps
  await requireUv(deps)

  const directory = resolve(cwd, options.directory ?? cwd)
  const state = await inspectInstall(directory, skillsCli)
  if (!state.bmadSkillDir) {
    prompts.fail(message(messages, 'nothingInstalled'))
    return 1
  }

  const report = await statusWithSpinner(deps, state.bmadSkillDir, directory)
  prompts.showNote(renderStatus(report, { failures: [], messages, modules }))
  return report.current ? 0 : 1
}
