import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const LOCK_FILE = '.skill-lock.json'
const PICK_FILE = 'last-agents.json'

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 * @returns {string}
 */
export function skillsLockPath(env = process.env, homeDir = homedir()) {
  const stateHome = env.XDG_STATE_HOME
  if (stateHome) return join(stateHome, 'skills', LOCK_FILE)
  return join(homeDir, '.agents', LOCK_FILE)
}

/**
 * The agents last picked in the skills CLI's own picker.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 * @returns {Promise<string[]>}
 */
export async function lastPickedAgents(env = process.env, homeDir = homedir()) {
  try {
    const lock = JSON.parse(await readFile(skillsLockPath(env, homeDir), 'utf8'))
    const agents = lock?.lastSelectedAgents
    return Array.isArray(agents) ? agents.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Our own last pick lives in `~/.bmad`, BMad's per-user folder.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 * @returns {string}
 */
export function savedPickPath(env = process.env, homeDir = homedir()) {
  return join(env.HOME || homeDir, '.bmad', PICK_FILE)
}

/**
 * The agents picked in our picker last time, or null before the first pick.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 * @returns {Promise<string[] | null>}
 */
export async function savedAgentPick(env = process.env, homeDir = homedir()) {
  try {
    const saved = JSON.parse(await readFile(savedPickPath(env, homeDir), 'utf8'))
    return Array.isArray(saved?.agents) ? saved.agents.filter((/** @type {unknown} */ id) => typeof id === 'string') : null
  } catch {
    return null
  }
}

/**
 * @param {string[]} agents
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 */
export async function saveAgentPick(agents, env = process.env, homeDir = homedir()) {
  const path = savedPickPath(env, homeDir)
  // Written aside and renamed over, so another run never reads a half-written pick.
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, `${JSON.stringify({ agents }, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
