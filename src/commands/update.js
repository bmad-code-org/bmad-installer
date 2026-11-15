import { resolve } from 'node:path'
import { inspectInstall, installedModuleCodes } from '../installed.js'
import { message } from '../messages.js'
import { findModule } from '../modules.js'
import { runPreflight } from '../preflight.js'
import { moduleSourceFromLock, readProjectLock } from '../project-lock.js'
import { agentsToUpdate } from './agent-choice.js'
import { applyCalls } from './apply.js'
import { endRun } from './ending.js'
import { versionsByCode } from './install-plan.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */
/** @typedef {import('./install-plan.js').InstallCall} InstallCall */

/**
 * One call per installed module: a module in modules.yaml from its folder with `-s '*'`, any
 * other from the source and ref the project lock recorded for its record, with its own skills
 * named. `unplaced` names the modules with no source to re-add from.
 * @param {CommandDeps} deps
 * @param {string} directory
 * @param {string[]} codes
 * @param {StatusReport | null} installed
 * @returns {Promise<{ calls: InstallCall[], unplaced: string[] }>}
 */
async function updateCalls(deps, directory, codes, installed) {
  const { modules } = deps
  const listed = modules.filter((module) => module.always || codes.some((code) => findModule(modules, code) === module))
  /** @type {InstallCall[]} */
  const calls = listed.map((module) => ({ source: module.source, skills: ['*'], label: module.name }))
  /** @type {string[]} */
  const unplaced = []
  const lock = await readProjectLock(directory)
  for (const entry of installed?.modules ?? []) {
    if (findModule(modules, entry.module)) continue
    const source = moduleSourceFromLock(lock[entry.folder], directory)
    if (!source) unplaced.push(entry.module)
    else calls.push({ source, skills: [...new Set([entry.folder, ...entry.skills, ...entry.absent_skills])], label: entry.module })
  }
  return { calls, unplaced }
}

/**
 * Re-adds every installed module, one `skills add` each, to the agents already holding BMad here.
 * `npx skills update` re-adds one skill at a time, a fresh clone each, and picks agents from the
 * folders in the project.
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
  const installedSkillDir = before.bmadSkillDir
  if (!installedSkillDir) {
    prompts.fail(message(messages, 'nothingToUpdate'))
    return 1
  }

  /** @type {StatusReport | null} */
  let wasInstalled = null
  /** @type {string[]} */
  let unplaced = []
  const { failures, bmadSkillDir, report } = await applyCalls(deps, {
    directory,
    agents: agentsToUpdate(deps, directory),
    spinner: 'updatingSpinner',
    bmadSkillDir: installedSkillDir,
    plan: async () => {
      wasInstalled = await bmadScripts.status(installedSkillDir, directory).catch(() => null)
      const codes = wasInstalled ? wasInstalled.modules.map((entry) => entry.module) : installedModuleCodes(before, modules)
      const planned = await updateCalls(deps, directory, codes, wasInstalled)
      unplaced = planned.unplaced
      return planned.calls
    },
  })
  if (!bmadSkillDir || !report) {
    prompts.fail(message(messages, 'nothingToUpdate'))
    return 1
  }
  if (unplaced.length > 0) prompts.say(message(messages, 'updateNotListed', { modules: unplaced.join(', ') }))

  await endRun(deps, { report, bmadSkillDir, before: versionsByCode(wasInstalled), failures, directory, updated: true })
  return failures.length === 0 ? 0 : 1
}
