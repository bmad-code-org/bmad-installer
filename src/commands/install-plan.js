import { customModule, isModuleSource } from '../modules.js'

/** @typedef {import('../bmad-scripts.js').Migration} Migration */
/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {{ source: string, skills: string[], label: string }} InstallCall */

const ALL_SKILLS = '*'

/**
 * Resolves the picked codes in modules.yaml order and adds the `always` modules, which neither
 * the flag nor the prompt ever contributes. Sources from `--modules` follow, in the order given.
 * @param {string[]} codes
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleDefinition[]}
 */
export function chosenModules(codes, modules) {
  const listed = modules.filter((module) => module.always || codes.includes(module.code))
  return [...listed, ...codes.filter(isModuleSource).map(customModule)]
}

/**
 * One skills add per module, for every skill in the module's folder. A module already installed
 * with nothing missing is left alone; `update` is what refreshes it.
 * @param {ModuleDefinition[]} chosen
 * @param {StatusReport | null} installed
 * @returns {InstallCall[]}
 */
export function moduleCalls(chosen, installed) {
  const entries = new Map((installed?.modules ?? []).map((entry) => [entry.module, entry]))
  return chosen
    .filter((module) => {
      const entry = entries.get(module.code)
      return !entry || entry.absent_skills.length > 0
    })
    .map((module) => ({ source: module.source, skills: [ALL_SKILLS], label: module.name }))
}

/**
 * The command that repeats this install without prompts.
 * @param {ModuleDefinition[]} chosen
 * @param {string[]} agents
 * @returns {string}
 */
export function repeatCommand(chosen, agents) {
  const picked = chosen.filter((module) => !module.always)
  const codes = (picked.length > 0 ? picked : chosen).map((module) => module.code)
  return `npx bmad-method install -m ${codes.join(',')} -t ${agents.join(',')} -y`
}

/**
 * @param {StatusReport | null} report
 * @returns {Record<string, string>}
 */
export function versionsByCode(report) {
  /** @type {Record<string, string>} */
  const versions = {}
  for (const entry of report?.modules ?? []) versions[entry.module] = entry.version
  return versions
}

/**
 * @param {string} version
 * @returns {string | null}
 */
export function versionMajor(version) {
  const match = /^v?(\d+)(?=[.\-+]|$)/.exec(version.trim())
  return match ? match[1] : null
}

/**
 * The migrations for a major version a module crossed in this run. A module the run did not
 * touch has the same version before and after, so it never matches.
 * @param {Migration[]} migrations
 * @param {{ before: Record<string, string>, after: Record<string, string> }} versions
 * @returns {Migration[]}
 */
export function selectMigrations(migrations, versions) {
  return migrations.filter((migration) => {
    const from = versionMajor(versions.before[migration.module] ?? '')
    const to = versionMajor(versions.after[migration.module] ?? '')
    return from !== null && from === migration.from && to !== null && to === migration.to
  })
}
