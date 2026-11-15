import { readFile } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve } from 'node:path'

/** @typedef {{ source?: string, sourceUrl?: string, sourceType?: string, ref?: string, skillPath?: string }} LockEntry */

/**
 * The skills CLI's project lock, `skills-lock.json`: where each skill was installed from.
 * @param {string} directory
 * @returns {Promise<Record<string, LockEntry>>}
 */
export async function readProjectLock(directory) {
  try {
    const lock = JSON.parse(await readFile(join(directory, 'skills-lock.json'), 'utf8'))
    return lock?.skills && typeof lock.skills === 'object' ? lock.skills : {}
  } catch {
    return {}
  }
}

/**
 * The folder holding a module, from the lock entry of its record: the parent of the record's own
 * folder, on the source and ref it came from. Mirrors the skills CLI's own update source, one
 * folder up. Null when the entry cannot be installed again (a bare shorthand for a generic git host).
 * @param {LockEntry | undefined} entry
 * @param {string} directory
 * @returns {string | null}
 */
export function moduleSourceFromLock(entry, directory) {
  if (!entry || entry.sourceType === 'well-known' || entry.sourceType === 'node_modules') return null
  const github = !entry.sourceType || entry.sourceType === 'github'
  let source = github ? entry.source : entry.sourceUrl || entry.source
  if (!source) return null
  const bareShorthand = !source.includes(':') && !/^[./]/.test(source)
  if ((entry.sourceType === 'git' || entry.sourceType === 'gitlab') && bareShorthand) return null
  if (entry.sourceType === 'local' && !isAbsolute(source)) source = resolve(directory, source)
  const skillFolder = (entry.skillPath ?? '').replace(/\/?SKILL\.md$/, '')
  const folder = skillFolder ? posix.dirname(skillFolder) : '.'
  const appendable = github || entry.sourceType === 'local'
  const withFolder = appendable && folder !== '.' ? `${source.replace(/\/+$/, '')}/${folder}` : source
  return entry.ref ? `${withFolder}#${entry.ref}` : withFolder
}
