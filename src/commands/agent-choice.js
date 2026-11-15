import {
  UNIVERSAL_AGENT,
  agentsHolding,
  collapseUniversal,
  detectAgents,
  detectContext,
  isUniversal,
  parseToolsFlag,
  sharedFolderHolds,
} from '../agents.js'
import { lastPickedAgents, saveAgentPick, savedAgentPick } from '../agent-picks.js'
import { BMAD_SKILL } from '../installed.js'

/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */

/**
 * The agents an install goes to. `--tools` wins. Otherwise the picker ticks the agents with their
 * own folder already holding BMad here, plus the shared-folder agents of the last pick when
 * `.agents/skills` holds it; with neither, the last pick. The last pick is our own saved one, else
 * the skills CLI's without its shared-folder agents. `--yes` takes those same ticks; with none,
 * the agents whose config folder is in the home folder, the way the skills CLI's own `--yes`
 * picks, or `universal` alone.
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {string} directory
 * @param {boolean} interactive
 * @returns {Promise<string[]>}
 */
export async function agentsToInstall(options, deps, directory, interactive) {
  const { agents, messages, prompts } = deps
  if (options.tools) return parseToolsFlag(options.tools, agents)
  const context = (deps.detect ?? detectContext)(directory)
  const listed = agents.filter((agent) => agent.id !== UNIVERSAL_AGENT)
  const shared = new Set(listed.filter(isUniversal).map((agent) => agent.id))
  // The skills CLI saves every shared-folder agent it shows as locked, so its pick says nothing about those.
  const saved = (await savedAgentPick(deps.env)) ?? (await lastPickedAgents(deps.env)).filter((id) => !shared.has(id))
  const last = saved.filter((id) => listed.some((agent) => agent.id === id))
  const holding = [
    ...agentsHolding(agents, BMAD_SKILL, context),
    ...(sharedFolderHolds(BMAD_SKILL, context) ? last.filter((id) => shared.has(id)) : []),
  ]
  const initial = holding.length > 0 ? holding : last

  if (!interactive) {
    if (initial.length > 0) return initial
    const detected = collapseUniversal(detectAgents(agents, context), agents)
    return detected.length > 0 ? detected : [UNIVERSAL_AGENT]
  }
  const picked = await prompts.chooseAgents(messages, agents, { initial })
  await saveAgentPick(picked, deps.env)
  return picked
}

/**
 * The agents an update goes to: those whose project folder already holds BMad, with `universal`
 * for `.agents/skills`.
 * @param {CommandDeps} deps
 * @param {string} directory
 * @returns {string[]}
 */
export function agentsToUpdate(deps, directory) {
  const context = (deps.detect ?? detectContext)(directory)
  const own = agentsHolding(deps.agents, BMAD_SKILL, context)
  const agents = sharedFolderHolds(BMAD_SKILL, context) ? [UNIVERSAL_AGENT, ...own] : own
  return agents.length > 0 ? agents : [UNIVERSAL_AGENT]
}
