import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOCK_FILE = '.skill-lock.json'

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
 * The agents last picked in the skills CLI's own picker, used to preselect ours.
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
