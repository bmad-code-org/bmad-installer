import { groupBySource } from '../modules.js'
import { versionMajor } from '../report.js'

/** @typedef {import('../bmad-scripts.js').Migration} Migration */
/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {{ source: string, skills: string[], label: string }} InstallCall */

/**
 * @param {string} source
 * @param {ModuleDefinition[]} modules
 * @returns {string}
 */
function callLabel(source, modules) {
  return modules.map((module) => module.name).join(', ') || source
}

/**
 * Resolves the picked codes in modules.yaml order and adds the `always` modules, which neither
 * the flag nor the prompt ever contributes.
 * @param {string[]} codes
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleDefinition[]}
 */
export function chosenModules(codes, modules) {
  return modules.filter((module) => module.always || codes.includes(module.code))
}

/**
 * Records already in the project are left alone; `update` is what refreshes them.
 * @param {ModuleDefinition[]} chosen
 * @param {string} firstSkill
 * @param {string[]} installed
 * @returns {InstallCall[]}
 */
export function recordCalls(chosen, firstSkill, installed = []) {
  /** @type {InstallCall[]} */
  const calls = []
  let first = true
  for (const [source, modules] of groupBySource(chosen)) {
    const wanted = modules.map((module) => module.record)
    if (first) wanted.unshift(firstSkill)
    first = false
    const skills = wanted.filter((skill) => !installed.includes(skill))
    if (skills.length > 0) calls.push({ source, skills, label: callLabel(source, modules) })
  }
  return calls
}

/**
 * Every skill a chosen module's record lists that is not installed yet.
 * @param {ModuleDefinition[]} chosen
 * @param {StatusReport} report
 * @returns {InstallCall[]}
 */
export function memberCalls(chosen, report) {
  const entries = new Map(report.modules.map((entry) => [entry.module, entry]))
  /** @type {Map<string, { skills: string[], modules: ModuleDefinition[] }>} */
  const bySource = new Map()
  for (const module of chosen) {
    const entry = entries.get(module.code)
    if (!entry || entry.absent_skills.length === 0) continue
    const group = bySource.get(module.source) ?? { skills: [], modules: [] }
    for (const skill of entry.absent_skills) if (!group.skills.includes(skill)) group.skills.push(skill)
    group.modules.push(module)
    bySource.set(module.source, group)
  }
  return [...bySource].map(([source, group]) => ({
    source,
    skills: group.skills,
    label: callLabel(source, group.modules),
  }))
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
 * @param {Migration[]} migrations
 * @param {{ codes: string[], before: Record<string, string>, after: Record<string, string> }} options
 * @returns {Migration[]}
 */
export function selectMigrations(migrations, options) {
  return migrations.filter((migration) => {
    if (!options.codes.includes(migration.module)) return false
    const from = versionMajor(options.before[migration.module] ?? '')
    const to = versionMajor(options.after[migration.module] ?? '')
    return from !== null && from === migration.from && to !== null && to === migration.to
  })
}
