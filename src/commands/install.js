import { SETUP_NEXT } from '../bmad-scripts.js'
import { message } from '../messages.js'
import { nodeFailureHint, runPreflight } from '../preflight.js'
import { renderFailures } from '../report.js'
import { agentsToInstall } from './agent-choice.js'
import { applyCalls } from './apply.js'
import { endRun } from './ending.js'
import { readExisting } from './existing-install.js'
import { chosenModules, moduleCalls, repeatCommand } from './install-plan.js'
import { announceUpdate, pickModuleCodes, resolveDirectory } from './install-steps.js'
import { update } from './update.js'

/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @returns {Promise<number>}
 */
export async function install(options, deps) {
  const { messages, modules, prompts, runner } = deps
  const interactive = !options.yes

  prompts.showIntro(messages)
  await announceUpdate(deps)
  await runPreflight({ interactive, runner, messages, terminal: deps.terminal, agent: deps.agent })

  const directory = await resolveDirectory(options, deps, interactive)
  const existing = await readExisting(directory, deps)
  if (existing.codes.length > 0 && interactive && (await prompts.chooseExistingAction(messages)) === 'update') {
    return update({ ...options, directory }, deps, { checked: true })
  }

  const chosen = chosenModules(await pickModuleCodes(options, deps, existing), modules)
  for (const module of chosen) {
    if (module.deprecated) {
      prompts.warn(message(messages, 'deprecatedModule', { module: module.name, reason: module.deprecated }))
    }
  }
  const kept = modules.filter((module) => existing.codes.includes(module.code) && !chosen.some((picked) => picked.code === module.code))
  if (kept.length > 0) {
    prompts.warn(message(messages, 'modulesKept', { modules: kept.map((module) => module.name).join(', ') }))
  }

  const agents = await agentsToInstall(options, deps, directory, interactive)
  const { failures, bmadSkillDir, report } = await applyCalls(deps, {
    directory,
    agents,
    spinner: 'installingSpinner',
    plan: () => moduleCalls(chosen, existing.report),
  })
  if (!bmadSkillDir || !report) {
    prompts.fail(failures.length > 0
      ? [renderFailures(failures, messages), nodeFailureHint(messages, deps.node)].filter(Boolean).join('\n')
      : message(messages, 'firstInstallNotInProject', { directory }))
    return 1
  }

  await endRun(deps, { report, bmadSkillDir, before: existing.versions, failures, directory, agents, repeat: repeatCommand(chosen, agents) })
  return failures.length === 0 && (report.current || report.next === SETUP_NEXT) ? 0 : 1
}
