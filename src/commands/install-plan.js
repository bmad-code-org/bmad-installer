import { bundleCodes, findModule, groupBySource, skillsToInstall } from '../modules.js'
import { versionMajor } from '../report.js'

/** @typedef {import('../bmad-scripts.js').Migration} Migration */
/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../modules.js').ModuleChoice} ModuleChoice */
/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {{ source: string, skills: string[], label: string }} InstallCall */
/** @typedef {{ module: string, skills: string[] }} UnknownSkills */

/**
 * @param {string} source
 * @param {ModuleDefinition[]} modules
 * @returns {string}
 */
function callLabel(source, modules) {
  return modules.length === 1 ? modules[0].name : source
}

/**
 * Puts the picked modules in modules.yaml order and adds the `always` ones, which neither
 * the flag nor the prompt ever contributes.
 * @param {ModuleChoice[]} choices
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleChoice[]}
 */
export function orderedChoices(choices, modules) {
  const picked = new Map(choices.map((choice) => [choice.code, choice]))
  /** @type {ModuleChoice[]} */
  const ordered = []
  for (const module of modules) {
    const choice = picked.get(module.code)
    if (choice) ordered.push(choice)
    else if (module.always) {
      ordered.push({
        code: module.code,
        bundles: module.bundles ? bundleCodes(module, (bundle) => bundle.default === true) : null,
      })
    }
  }
  return ordered
}

/**
 * @param {ModuleChoice[]} choices
 * @param {ModuleDefinition[]} modules
 * @returns {ModuleDefinition[]}
 */
export function chosenModules(choices, modules) {
  return choices.flatMap((choice) => {
    const module = findModule(modules, choice.code)
    return module ? [module] : []
  })
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
 * @param {ModuleChoice[]} choices
 * @param {ModuleDefinition[]} modules
 * @param {StatusReport} report
 * @returns {{ calls: InstallCall[], unknown: UnknownSkills[] }}
 */
export function memberCalls(choices, modules, report) {
  const entries = new Map(report.modules.map((entry) => [entry.module, entry]))
  /** @type {Map<string, { skills: string[], modules: ModuleDefinition[] }>} */
  const bySource = new Map()
  /** @type {UnknownSkills[]} */
  const unknown = []

  for (const choice of choices) {
    const module = findModule(modules, choice.code)
    const entry = module && entries.get(module.code)
    if (!module || !entry) continue
    const wanted = skillsToInstall(module, choice.bundles, [...entry.skills, ...entry.absent_skills])
    if (wanted.unknown.length > 0) unknown.push({ module: module.name, skills: wanted.unknown })
    const missing = wanted.install.filter((skill) => entry.absent_skills.includes(skill))
    if (missing.length === 0) continue
    const group = bySource.get(module.source) ?? { skills: [], modules: [] }
    for (const skill of missing) if (!group.skills.includes(skill)) group.skills.push(skill)
    group.modules.push(module)
    bySource.set(module.source, group)
  }

  const calls = [...bySource].map(([source, group]) => ({
    source,
    skills: group.skills,
    label: callLabel(source, group.modules),
  }))
  return { calls, unknown }
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
