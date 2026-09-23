import { resolve } from 'node:path'
import { inspectInstall } from '../installed.js'
import { message } from '../messages.js'
import { runPreflight } from '../preflight.js'
import { renderClosing, renderMigrations, renderModuleMessages, renderStatus } from '../report.js'
import { selectMigrations, versionsByCode } from './install-plan.js'
import { statusWithSpinner } from './status.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('./install.js').CommandDeps} CommandDeps */

/**
 * @param {CommandDeps} deps
 * @param {string} bmadSkillDir
 * @param {string} projectRoot
 * @returns {Promise<StatusReport | null>}
 */
async function optionalStatus(deps, bmadSkillDir, projectRoot) {
  try {
    return await statusWithSpinner(deps, bmadSkillDir, projectRoot)
  } catch {
    return null
  }
}

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @returns {Promise<number>}
 */
export async function update(options, deps) {
  const { bmadScripts, messages, modules, prompts, runner, skillsCli, cwd } = deps
  await runPreflight({ interactive: false, runner, messages, warn: prompts.warn })

  const directory = resolve(cwd, options.directory ?? cwd)
  const before = await inspectInstall(directory, skillsCli)
  if (!before.bmadSkillDir) {
    prompts.fail(message(messages, 'nothingToUpdate'))
    return 1
  }

  const wasInstalled = await optionalStatus(deps, before.bmadSkillDir, directory)
  const result = await skillsCli.update({ cwd: directory })
  prompts.say(message(messages, 'updateSpinnerDone'))

  const after = await inspectInstall(directory, skillsCli)
  const bmadSkillDir = after.bmadSkillDir ?? before.bmadSkillDir
  const report = await statusWithSpinner(deps, bmadSkillDir, directory)
  const codes = report.modules.map((entry) => entry.module)

  const migrations = selectMigrations(await bmadScripts.migrations(bmadSkillDir), {
    codes,
    before: versionsByCode(wasInstalled),
    after: versionsByCode(report),
  })
  const migrationText = renderMigrations(migrations, messages)
  if (migrationText) prompts.showNote(migrationText)

  prompts.showNote(renderStatus(report, { failures: [], messages, modules }))
  const moduleText = renderModuleMessages(modules.filter((module) => codes.includes(module.code)))
  if (moduleText) prompts.showNote(moduleText)
  prompts.showNote(renderClosing(messages, { directory }))
  prompts.finish('')

  return result.code === 0 ? 0 : 1
}
