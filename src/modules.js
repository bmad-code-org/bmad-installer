import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { packageRoot } from './version.js'

/** @typedef {{ code: string, name: string, description: string, source: string, record: string, aliases?: string[], always?: boolean, default?: boolean, deprecated?: string, message?: string }} ModuleDefinition */

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
 * @param {string} value
 * @param {ModuleDefinition[]} modules
 * @returns {string[]}
 */
export function parseModulesFlag(value, modules) {
  /** @type {string[]} */
  const codes = []
  for (const token of value.split(',')) {
    const codeOrAlias = token.trim()
    if (codeOrAlias === '') continue
    const module = findModule(modules, codeOrAlias)
    if (!module) throw new ModulesError(`unknown module "${codeOrAlias}"`)
    if (!codes.includes(module.code)) codes.push(module.code)
  }
  return codes
}

/**
 * @param {ModuleDefinition[]} modules
 * @returns {string[]}
 */
export function defaultCodes(modules) {
  return modules.filter((module) => module.default === true).map((module) => module.code)
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
