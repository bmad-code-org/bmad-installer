import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pickedAgents, skillsLockPath, snapshotLock } from '../harness.js'
import { hasSkills, inspectInstall } from '../installed.js'
import { message } from '../messages.js'
import { defaultChoices, findModule, parseModulesFlag } from '../modules.js'
import { Cancelled } from '../prompts.js'
import { distTag, newerVersion } from '../self-update.js'
import { versionsByCode } from './install-plan.js'
import { statusWithSpinner } from './status.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('../installed.js').InstalledState} InstalledState */
/** @typedef {import('../modules.js').ModuleChoice} ModuleChoice */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */
/** @typedef {import('./install.js').CommandDeps} CommandDeps */
/** @typedef {import('./install-plan.js').InstallCall} InstallCall */
/** @typedef {{ state: InstalledState, report: StatusReport | null, codes: string[], versions: Record<string, string> }} Existing */

/** @param {string} path */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * @param {string | undefined} value
 * @returns {string[] | null}
 */
export function parseTools(value) {
  if (!value) return null
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean)
  return ids.length > 0 ? ids : null
}

/**
 * @param {CommandDeps} deps
 * @returns {Promise<void>}
 */
export async function announceUpdate(deps) {
  const latest = await newerVersion({ runner: deps.runner, version: deps.version })
  if (!latest) return
  deps.prompts.showNote(
    message(deps.messages, 'updateAvailable', { current: deps.version, latest, tag: distTag(deps.version) }),
  )
}

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {boolean} interactive
 * @returns {Promise<string>}
 */
export async function resolveDirectory(options, deps, interactive) {
  const { cwd, messages, prompts } = deps
  const asked = options.directory ?? (interactive ? await prompts.askDirectory(messages, cwd) : cwd)
  const directory = resolve(cwd, asked)

  if (await isDirectory(directory)) {
    if (interactive && !(await prompts.confirm(message(messages, 'directoryConfirm', { directory })))) {
      throw new Cancelled()
    }
    return directory
  }
  if (interactive && !(await prompts.confirm(message(messages, 'directoryCreateConfirm', { directory })))) {
    throw new Cancelled()
  }
  await mkdir(directory, { recursive: true })
  return directory
}

/**
 * @param {CommandDeps} deps
 * @param {string[]} codes
 * @param {Record<string, string>} versions
 * @returns {string}
 */
function foundModulesText(deps, codes, versions) {
  const { messages, modules } = deps
  const lines = [message(messages, 'foundModules')]
  for (const code of codes) {
    const version = versions[code]
    const suffix = version
      ? message(messages, 'installedSuffix', { version })
      : message(messages, 'installedSuffixNoVersion')
    lines.push(`${findModule(modules, code)?.name ?? code} ${suffix}`)
  }
  return lines.join('\n')
}

/**
 * @param {string} directory
 * @param {CommandDeps} deps
 * @returns {Promise<Existing>}
 */
export async function readExisting(directory, deps) {
  const { messages, prompts, skillsCli } = deps
  const state = await inspectInstall(directory, skillsCli)
  /** @type {StatusReport | null} */
  let report = null
  if (state.bmadSkillDir) {
    try {
      report = await statusWithSpinner(deps, state.bmadSkillDir, directory)
    } catch {
      report = null
    }
  }
  const codes = report ? report.modules.map((entry) => entry.module) : state.moduleCodes
  const versions = versionsByCode(report)

  if (state.legacyManifest) prompts.say(message(messages, 'legacyManifest'))
  if (codes.length > 0) prompts.say(foundModulesText(deps, codes, versions))
  return { state, report, codes, versions }
}

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {Existing} existing
 * @returns {Promise<ModuleChoice[]>}
 */
export async function pickChoices(options, deps, existing) {
  const { messages, modules, prompts } = deps
  if (options.modules) return parseModulesFlag(options.modules, modules)
  if (options.yes) return defaultChoices(modules)

  const installedSkills = existing.state.skills.map((skill) => skill.name)
  const codes = await prompts.chooseModules(messages, modules, {
    installedCodes: existing.codes,
    installedVersions: existing.versions,
  })
  /** @type {ModuleChoice[]} */
  const choices = []
  for (const code of codes) {
    const module = findModule(modules, code)
    if (!module) continue
    const bundles = module.bundles ? await prompts.chooseBundles(messages, module, { installedSkills }) : null
    choices.push({ code: module.code, bundles })
  }
  return choices
}

/**
 * @param {InstallCall} call
 * @param {string[] | null} agents
 * @param {string} directory
 * @param {CommandDeps} deps
 * @returns {Promise<AddResult[]>}
 */
export async function headlessAdd(call, agents, directory, deps) {
  const spinner = deps.prompts.startSpinner(message(deps.messages, 'installingSpinner', { what: call.label }))
  try {
    const results = await deps.skillsCli.add({ source: call.source, skills: call.skills, agents, cwd: directory })
    return results.filter((entry) => entry.status !== 'installed')
  } finally {
    spinner.stop()
  }
}

/**
 * Runs the add calls of one install. When `pick` is set, the first call hands the terminal to the
 * skills CLI so its own agent picker runs; no spinner runs across it, and the picked agent ids come
 * back through the CLI's lock file for every call after it.
 * @param {{ directory: string, deps: CommandDeps, agents: string[] | null, pick: boolean }} context
 */
export function createAdds(context) {
  const { directory, deps } = context
  const { env, messages, prompts, skillsCli } = deps
  let agents = context.agents
  let pickPending = context.pick

  /** @param {InstallCall} call @returns {Promise<boolean>} */
  async function addInteractively(call) {
    prompts.showNote(message(messages, 'beforeSkillsPicker'))
    const lockPath = skillsLockPath(env)
    const before = await snapshotLock(lockPath)
    await skillsCli.addInteractive({ source: call.source, skills: call.skills, cwd: directory })
    agents = await pickedAgents(lockPath, before)
    const landed = hasSkills(await inspectInstall(directory, skillsCli), call.skills)
    if (!landed) prompts.fail(message(messages, 'firstInstallNotInProject', { directory }))
    return landed
  }

  return {
    /** @returns {string[] | null} */
    agents: () => agents,
    /**
     * @param {InstallCall} call
     * @returns {Promise<{ landed: boolean, failures: AddResult[] }>}
     */
    async run(call) {
      if (!pickPending) return { landed: true, failures: await headlessAdd(call, agents, directory, deps) }
      pickPending = false
      return { landed: await addInteractively(call), failures: [] }
    },
  }
}
