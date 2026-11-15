import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const LOCK_FILE = '.skill-lock.json'
const LOCK_VERSION = 3

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
 * The agents last picked, in our picker or the skills CLI's own, used to preselect ours.
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
 * Records our pick where the skills CLI keeps its own, so the next run of either picker starts
 * from it. Everything else in the lock is kept; a lock the CLI would discard starts over as it would.
 * @param {string[]} agents
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 */
export async function saveLastPickedAgents(agents, env = process.env, homeDir = homedir()) {
  const lockPath = skillsLockPath(env, homeDir)
  /** @type {Record<string, unknown>} */
  let lock = { version: LOCK_VERSION, skills: {}, dismissed: {} }
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8'))
    if (typeof parsed?.version === 'number' && parsed.version >= LOCK_VERSION && parsed.skills) lock = parsed
  } catch {}
  try {
    await mkdir(dirname(lockPath), { recursive: true })
    await writeFile(lockPath, JSON.stringify({ ...lock, lastSelectedAgents: agents }, null, 2), 'utf8')
  } catch {}
}
