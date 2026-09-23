import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** @typedef {{ exists: boolean, mtimeMs: number | null }} LockSnapshot */

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
 * @param {string} lockPath
 * @returns {Promise<string[] | null>}
 */
async function readSelectedAgents(lockPath) {
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'))
    const agents = lock?.lastSelectedAgents
    if (!Array.isArray(agents) || agents.length === 0) return null
    if (!agents.every((id) => typeof id === 'string')) return null
    return agents
  } catch {
    return null
  }
}

/**
 * @param {string} lockPath
 * @returns {Promise<LockSnapshot>}
 */
export async function snapshotLock(lockPath) {
  try {
    const info = await stat(lockPath)
    return { exists: true, mtimeMs: info.mtimeMs }
  } catch {
    return { exists: false, mtimeMs: null }
  }
}

/**
 * A lock rewritten during the interactive call means the CLI's agent picker ran, and a pick that
 * matches the previous one is still a pick. The CLI's one-time find-skills prompt can also rewrite
 * the lock; the selection it carries forward is then the user's own last pick, which beats leaving
 * the later calls to the CLI's auto-detection.
 * @param {string} lockPath
 * @param {LockSnapshot} before
 * @returns {Promise<string[] | null>}
 */
export async function pickedAgents(lockPath, before) {
  const after = await snapshotLock(lockPath)
  if (!after.exists) return null
  if (before.exists && (after.mtimeMs ?? 0) <= (before.mtimeMs ?? 0)) return null
  return readSelectedAgents(lockPath)
}
