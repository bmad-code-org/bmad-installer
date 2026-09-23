import { access } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {import('./skills-cli.js').ListedSkill} ListedSkill */
/** @typedef {{ skills: ListedSkill[], bmadSkillDir: string | null, moduleCodes: string[], legacyManifest: boolean }} InstalledState */

export const BMAD_SKILL = 'bmad'
export const RECORD_PREFIX = 'bmod-'

const LEGACY_MANIFEST = ['_bmad', '_config', 'manifest.yaml']

/**
 * @param {string} dir
 * @param {{ list(options: { cwd: string }): Promise<ListedSkill[]> }} skillsCli
 * @returns {Promise<InstalledState>}
 */
export async function inspectInstall(dir, skillsCli) {
  const skills = await skillsCli.list({ cwd: dir })
  const bmad = skills.find((skill) => skill.name === BMAD_SKILL)
  const moduleCodes = skills.flatMap((skill) => {
    const code = moduleCodeFromRecord(skill.name)
    return code ? [code] : []
  })
  return {
    skills,
    bmadSkillDir: bmad ? bmad.path : null,
    moduleCodes,
    legacyManifest: await exists(join(dir, ...LEGACY_MANIFEST)),
  }
}

/**
 * @param {string} name
 * @returns {string | null}
 */
export function moduleCodeFromRecord(name) {
  if (!name.startsWith(RECORD_PREFIX)) return null
  const code = name.slice(RECORD_PREFIX.length)
  return code.length > 0 ? code : null
}

/**
 * @param {InstalledState} state
 * @param {string[]} names
 * @returns {boolean}
 */
export function hasSkills(state, names) {
  const installed = new Set(state.skills.map((skill) => skill.name))
  return names.every((name) => installed.has(name))
}

/** @param {string} path */
async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
