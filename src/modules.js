import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { packageRoot } from './version.js'

/** @typedef {{ code: string, name: string, description: string, default?: boolean, skills: string[] }} Bundle */
/** @typedef {{ code: string, name: string, description: string, source: string, record: string, aliases?: string[], always?: boolean, default?: boolean, deprecated?: string, message?: string, bundles?: Bundle[] }} ModuleDefinition */
/** @typedef {{ code: string, bundles: string[] | null }} ModuleChoice */

const SOURCE_PATTERN = /^[\w.-]+\/[\w.-]+$/
const SOURCE_OVERRIDE = 'BMAD_INSTALLER_SOURCE_OVERRIDE'

export class ModulesError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'ModulesError'
  }
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string} field
 * @returns {string}
 */
function requireText(value, where, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ModulesError(`${where}: ${field} must be a non-empty string`)
  }
  return value
}

/**
 * @param {any} entry
 * @param {string} where
 * @returns {Bundle}
 */
function validateBundle(entry, where) {
  const code = requireText(entry?.code, where, 'code')
  const at = `${where} bundle "${code}"`
  const skills = entry.skills
  if (!Array.isArray(skills) || skills.length === 0) {
    throw new ModulesError(`${at}: skills must be a non-empty array`)
  }
  /** @type {Bundle} */
  const bundle = {
    code,
    name: requireText(entry.name, at, 'name'),
    description: requireText(entry.description, at, 'description'),
    skills: skills.map((skill, index) => requireText(skill, at, `skills[${index}]`)),
  }
  if (entry.default === true) bundle.default = true
  return bundle
}

/**
 * @param {any} entry
 * @param {number} index
 * @param {Set<string>} taken
 * @returns {ModuleDefinition}
 */
function validateModule(entry, index, taken) {
  const code = requireText(entry?.code, `modules[${index}]`, 'code')
  const where = `module "${code}"`
  const source = requireText(entry.source, where, 'source')
  if (!SOURCE_PATTERN.test(source)) {
    throw new ModulesError(`${where}: source must look like owner/repo`)
  }
  /** @type {ModuleDefinition} */
  const module = {
    code,
    name: requireText(entry.name, where, 'name'),
    description: requireText(entry.description, where, 'description'),
    source,
    record: requireText(entry.record, where, 'record'),
  }
  for (const claimed of [code, ...(entry.aliases ?? [])]) {
    const text = requireText(claimed, where, 'aliases')
    if (taken.has(text)) throw new ModulesError(`${where}: "${text}" is already used by another module`)
    taken.add(text)
  }
  if (entry.aliases) module.aliases = [...entry.aliases]
  if (entry.always === true) module.always = true
  if (entry.default === true) module.default = true
  if (entry.deprecated !== undefined) module.deprecated = requireText(entry.deprecated, where, 'deprecated')
  if (entry.message !== undefined) module.message = requireText(entry.message, where, 'message')
  if (entry.bundles !== undefined) {
    if (!Array.isArray(entry.bundles)) throw new ModulesError(`${where}: bundles must be an array`)
    const bundles = entry.bundles.map((/** @type {any} */ bundle) => validateBundle(bundle, where))
    if (new Set(bundles.map((/** @type {Bundle} */ bundle) => bundle.code)).size !== bundles.length) {
      throw new ModulesError(`${where}: bundle codes must be unique`)
    }
    module.bundles = bundles
  }
  return module
}

/**
 * @param {string} [filePath]
 * @returns {Promise<ModuleDefinition[]>}
 */
export async function loadModules(filePath = join(packageRoot, 'modules.yaml')) {
  const document = parse(await readFile(filePath, 'utf8'))
  const entries = document?.modules
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ModulesError('modules must be a non-empty array')
  }
  /** @type {Set<string>} */
  const taken = new Set()
  const modules = entries.map((entry, index) => validateModule(entry, index, taken))
  const override = process.env[SOURCE_OVERRIDE]
  return override ? modules.map((module) => ({ ...module, source: override })) : modules
}

/**
 * @param {ModuleDefinition[]} modules
 * @param {string} codeOrAlias
 * @returns {ModuleDefinition | undefined}
 */
export function findModule(modules, codeOrAlias) {
  return modules.find((module) => module.code === codeOrAlias || (module.aliases ?? []).includes(codeOrAlias))
}

/**
 * @param {ModuleDefinition} module
 * @param {(bundle: Bundle) => boolean} filter
 * @returns {string[]}
 */
export function bundleCodes(module, filter) {
  return (module.bundles ?? []).filter(filter).map((bundle) => bundle.code)
}

/**
 * @param {ModuleDefinition} module
 * @param {string} list
 * @returns {string[]}
 */
function parseBundleList(module, list) {
  return list.split('+').map((raw) => {
    const code = raw.trim()
    if (!(module.bundles ?? []).some((bundle) => bundle.code === code)) {
      throw new ModulesError(`unknown bundle "${code}" for module "${module.code}"`)
    }
    return code
  })
}

/**
 * @param {string} value
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleChoice[]}
 */
export function parseModulesFlag(value, modules) {
  /** @type {ModuleChoice[]} */
  const choices = []
  for (const token of value.split(',')) {
    const trimmed = token.trim()
    if (trimmed === '') continue
    const separator = trimmed.indexOf(':')
    const codeOrAlias = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim()
    const module = findModule(modules, codeOrAlias)
    if (!module) throw new ModulesError(`unknown module "${codeOrAlias}"`)
    const listed = separator === -1
      ? bundleCodes(module, (bundle) => bundle.default === true)
      : parseBundleList(module, trimmed.slice(separator + 1))
    const existing = choices.find((choice) => choice.code === module.code)
    if (!existing) choices.push({ code: module.code, bundles: module.bundles ? [...new Set(listed)] : null })
    else if (existing.bundles) existing.bundles = [...new Set([...existing.bundles, ...listed])]
  }
  return choices
}

/**
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleChoice[]}
 */
export function defaultChoices(modules) {
  return modules
    .filter((module) => module.default === true)
    .map((module) => ({
      code: module.code,
      bundles: module.bundles ? bundleCodes(module, (bundle) => bundle.default === true) : null,
    }))
}

/**
 * @param {ModuleDefinition} module
 * @param {string[] | null} chosenBundles
 * @param {string[]} recordSkills
 * @returns {{ install: string[], unknown: string[] }}
 */
export function skillsToInstall(module, chosenBundles, recordSkills) {
  if (!chosenBundles || !module.bundles) return { install: [...recordSkills], unknown: [] }
  const chosen = new Set(chosenBundles)
  /** @type {Set<string>} */
  const wanted = new Set()
  for (const bundle of module.bundles) {
    if (!chosen.has(bundle.code)) continue
    for (const skill of bundle.skills) wanted.add(skill)
  }
  const available = new Set(recordSkills)
  /** @type {string[]} */
  const install = []
  /** @type {string[]} */
  const unknown = []
  for (const skill of wanted) (available.has(skill) ? install : unknown).push(skill)
  return { install, unknown }
}

/**
 * @param {ModuleDefinition[]} modules
 * @returns {Map<string, ModuleDefinition[]>}
 */
export function groupBySource(modules) {
  /** @type {Map<string, ModuleDefinition[]>} */
  const groups = new Map()
  for (const module of modules) {
    const existing = groups.get(module.source)
    if (existing) existing.push(module)
    else groups.set(module.source, [module])
  }
  return groups
}
