import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  UNIVERSAL_AGENT,
  agentsHolding,
  collapseUniversal,
  detectAgents,
  detectContext,
  isUniversal,
  parseToolsFlag,
  sharedFolderHolds,
} from '../agents.js'
import { lastPickedAgents, saveAgentPick, savedAgentPick } from '../harness.js'
import { BMAD_SKILL, inspectInstall, installedModuleCodes } from '../installed.js'
import { message } from '../messages.js'
import { defaultCodes, findModule, parseModulesFlag } from '../modules.js'
import { Cancelled } from '../prompts.js'
import { distTag, newerVersion } from '../self-update.js'
import { versionsByCode } from './install-plan.js'
import { statusWithSpinner } from './status.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('../installed.js').InstalledState} InstalledState */
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
  const { messages, modules, prompts, skillsCli } = deps
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
  const codes = report ? report.modules.map((entry) => entry.module) : installedModuleCodes(state, modules)
  const versions = versionsByCode(report)

  if (state.legacyManifest) prompts.say(message(messages, 'legacyManifest'))
  if (codes.length > 0) prompts.say(foundModulesText(deps, codes, versions))
  return { state, report, codes, versions }
}

/**
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {Existing} existing
 * @returns {Promise<string[]>}
 */
export async function pickChoices(options, deps, existing) {
  const { messages, modules, prompts } = deps
  if (options.modules) return parseModulesFlag(options.modules, modules)
  if (options.yes) return defaultCodes(modules)
  return prompts.chooseModules(messages, modules, {
    installedCodes: existing.codes,
    installedVersions: existing.versions,
  })
}

/**
 * `--tools` wins. Without it, `--yes` takes the agents found on this machine, those sharing
 * `.agents/skills` folded into the `universal` id, or `universal` alone when none is found.
 * Otherwise the picker ticks the agents with their own folder already holding BMad here, plus
 * the shared-folder agents of the last pick when `.agents/skills` holds it; with neither, the
 * last pick. The last pick is our own saved one, else the skills CLI's without its shared-folder
 * agents. Agents found on this machine are listed first but not ticked.
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {string} directory
 * @param {boolean} interactive
 * @returns {Promise<string[]>}
 */
export async function chooseAgents(options, deps, directory, interactive) {
  const { agents, messages, prompts } = deps
  if (options.tools) return parseToolsFlag(options.tools, agents)
  const context = (deps.detect ?? detectContext)(directory)
  const found = detectAgents(agents, context)
  const detected = collapseUniversal(found, agents)
  if (!interactive) return detected.length > 0 ? detected : [UNIVERSAL_AGENT]

  const listed = agents.filter((agent) => agent.id !== UNIVERSAL_AGENT)
  const shared = new Set(listed.filter(isUniversal).map((agent) => agent.id))
  // The skills CLI saves every shared-folder agent it shows as locked, so its pick says nothing about those.
  const saved = (await savedAgentPick(deps.env)) ?? (await lastPickedAgents(deps.env)).filter((id) => !shared.has(id))
  const last = saved.filter((id) => listed.some((agent) => agent.id === id))
  const holding = [
    ...agentsHolding(agents, BMAD_SKILL, context),
    ...(sharedFolderHolds(BMAD_SKILL, context) ? last.filter((id) => shared.has(id)) : []),
  ]
  const picked = await prompts.chooseAgents(messages, agents, { initial: holding.length > 0 ? holding : last, found })
  await saveAgentPick(picked, deps.env)
  return picked
}

/**
 * @param {InstallCall} call
 * @param {string[]} agents
 * @param {string} directory
 * @param {CommandDeps} deps
 * @returns {Promise<AddResult[]>}
 */
export async function add(call, agents, directory, deps) {
  const results = await deps.skillsCli.add({ source: call.source, skills: call.skills, agents, cwd: directory })
  return results.filter((entry) => entry.status !== 'installed')
}
