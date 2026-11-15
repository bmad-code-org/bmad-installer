import { access } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {import('./skills-cli.js').ListedSkill} ListedSkill */
/** @typedef {import('./modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {{ skills: ListedSkill[], bmadSkillDir: string | null, legacyManifest: boolean }} InstalledState */

export const BMAD_SKILL = 'bmad'

const LEGACY_MANIFEST = ['_bmad', '_config', 'manifest.yaml']

/**
 * @param {string} dir
 * @param {{ list(options: { cwd: string }): Promise<ListedSkill[]> }} skillsCli
 * @returns {Promise<InstalledState>}
 */
export async function inspectInstall(dir, skillsCli) {
  const skills = await skillsCli.list({ cwd: dir })
  const bmad = skills.find((skill) => skill.name === BMAD_SKILL)
  return {
    skills,
    bmadSkillDir: bmad ? bmad.path : null,
    legacyManifest: await exists(join(dir, ...LEGACY_MANIFEST)),
  }
}

/**
 * The modules whose record skill is installed. A record is a `bmod-*` skill or, for a
 * module of one skill, that skill itself, so only modules.yaml can name it.
 * @param {InstalledState} state
 * @param {ModuleDefinition[]} modules
 * @returns {string[]}
 */
export function installedModuleCodes(state, modules) {
  const installed = new Set(state.skills.map((skill) => skill.name))
  return modules.filter((module) => installed.has(module.record)).map((module) => module.code)
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
