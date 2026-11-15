import { customModule, isModuleSource, sourceAtRef } from '../modules.js'

/** @typedef {import('../bmad-scripts.js').Migration} Migration */
/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {{ source: string, skills: string[], label: string }} InstallCall */

const ALL_SKILLS = '*'

/**
 * Resolves the picked codes in modules.yaml order and adds the `always` modules, which neither
 * the flag nor the prompt has to name, and the modules the picked ones require. A code picked as
 * `code#ref` comes from that branch or tag. Sources from `--modules` follow, in the order given.
 * @param {string[]} codes
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleDefinition[]}
 */
export function chosenModules(codes, modules) {
  /** @type {Map<string, string | undefined>} */
  const refs = new Map()
  for (const picked of codes) {
    if (isModuleSource(picked)) continue
    const [code, ref] = picked.split('#')
    refs.set(code, ref)
  }
  for (const code of requiredCodes([...refs.keys()], modules)) refs.set(code, undefined)
  const listed = modules
    .filter((module) => module.always || refs.has(module.code))
    .map((module) => {
      const ref = refs.get(module.code)
      return ref ? { ...module, source: sourceAtRef(module.source, ref), ref } : module
    })
  return [...listed, ...codes.filter(isModuleSource).map(customModule)]
}

/**
 * The codes the picked modules require, directly or through another required module, that were
 * not picked themselves.
 * @param {string[]} picked
 * @param {ModuleDefinition[]} modules
 * @returns {string[]}
 */
export function requiredCodes(picked, modules) {
  const wanted = new Set(picked.map((code) => code.split('#')[0]))
  /** @type {string[]} */
  const added = []
  for (const code of wanted) {
    for (const required of modules.find((module) => module.code === code)?.requires ?? []) {
      if (wanted.has(required)) continue
      wanted.add(required)
      added.push(required)
    }
  }
  return added
}

/**
 * One skills add per module, for every skill in the module's folder. A module already installed
 * with nothing missing is left alone, since `update` is what refreshes it, unless a ref was asked for.
 * @param {ModuleDefinition[]} chosen
 * @param {StatusReport | null} installed
 * @returns {InstallCall[]}
 */
export function moduleCalls(chosen, installed) {
  const entries = new Map((installed?.modules ?? []).map((entry) => [entry.module, entry]))
  return chosen
    .filter((module) => {
      const entry = entries.get(module.code)
      return module.ref || !entry || entry.absent_skills.length > 0
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
  const picked = chosen.filter((module) => !module.always || module.ref)
  const codes = (picked.length > 0 ? picked : chosen).map((module) => (module.ref ? `${module.code}#${module.ref}` : module.code))
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
