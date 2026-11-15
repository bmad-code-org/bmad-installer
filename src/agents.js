import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from './version.js'

/** @typedef {{ id: string, name: string, skillsDir: string, detect: string[] }} Agent */
/** @typedef {{ skillsVersion: string, agents: Agent[] }} AgentsFile */
/** @typedef {{ home: string, project: string, exists: (path: string) => boolean }} DetectContext */

export const UNIVERSAL_DIR = '.agents/skills'
export const UNIVERSAL_AGENT = 'universal'

export class AgentsError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'AgentsError'
  }
}

/**
 * @param {string} [filePath]
 * @returns {Promise<Agent[]>}
 */
export async function loadAgents(filePath = join(packageRoot, 'agents.json')) {
  /** @type {AgentsFile} */
  const file = JSON.parse(await readFile(filePath, 'utf8'))
  return file.agents
}

/**
 * @param {string} project
 * @returns {DetectContext}
 */
export function detectContext(project) {
  return { home: homedir(), project, exists: existsSync }
}

/**
 * @param {string} path
 * @param {DetectContext} context
 */
function expand(path, context) {
  if (path === '~' || path.startsWith('~/')) return join(context.home, path.slice(1))
  if (path.startsWith('./')) return join(context.project, path.slice(2))
  return path
}

/**
 * The agents the skills CLI would detect on this machine, from the paths agents.json records,
 * not collapsed.
 * @param {Agent[]} agents
 * @param {DetectContext} context
 * @returns {string[]}
 */
export function detectAgents(agents, context) {
  return agents
    .filter((agent) => agent.detect.some((path) => context.exists(expand(path, context))))
    .map((agent) => agent.id)
}

/** @param {Agent} agent */
export function isUniversal(agent) {
  return agent.skillsDir === UNIVERSAL_DIR
}

/**
 * Every agent that reads `.agents/skills` gets the same files, so they all become the one
 * `universal` id, listed first.
 * @param {string[]} ids
 * @param {Agent[]} agents
 * @returns {string[]}
 */
export function collapseUniversal(ids, agents) {
  const shared = new Set(agents.filter(isUniversal).map((agent) => agent.id))
  const rest = ids.filter((id) => !shared.has(id))
  const collapsed = ids.some((id) => shared.has(id)) ? [UNIVERSAL_AGENT, ...rest] : rest
  return [...new Set(collapsed)]
}

/**
 * The agents with a folder of their own whose copy in the project already holds `skill`.
 * `.agents/skills` holding it says nothing about which of the agents sharing it the user wants.
 * @param {Agent[]} agents
 * @param {string} skill
 * @param {DetectContext} context
 * @returns {string[]}
 */
export function agentsHolding(agents, skill, context) {
  return agents
    .filter((agent) => !isUniversal(agent))
    .filter((agent) => context.exists(join(context.project, agent.skillsDir, skill)))
    .map((agent) => agent.id)
}

/**
 * @param {string} skill
 * @param {DetectContext} context
 */
export function sharedFolderHolds(skill, context) {
  return context.exists(join(context.project, UNIVERSAL_DIR, skill))
}

/**
 * Reads `--tools`, matching an id or a display name without regard to case.
 * @param {string} value
 * @param {Agent[]} agents
 * @returns {string[]}
 */
export function parseToolsFlag(value, agents) {
  /** @type {string[]} */
  const ids = []
  /** @type {string[]} */
  const unknown = []
  for (const token of value.split(',')) {
    const wanted = token.trim().toLowerCase()
    if (wanted === '') continue
    const agent = agents.find((entry) => entry.id.toLowerCase() === wanted || entry.name.toLowerCase() === wanted)
    if (!agent) unknown.push(token.trim())
    else if (!ids.includes(agent.id)) ids.push(agent.id)
  }
  if (unknown.length > 0) throw new AgentsError(unknown.join(', '))
  if (ids.length === 0) throw new AgentsError(value)
  return ids
}
