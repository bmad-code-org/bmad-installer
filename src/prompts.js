import {
  autocompleteMultiselect,
  cancel,
  confirm as confirmPrompt,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts'
import { UNIVERSAL_AGENT, isUniversal } from './agents.js'
import { message } from './messages.js'

const SHARED_NAMES_SHOWN = 4

/** @typedef {import('./agents.js').Agent} Agent */
/** @typedef {Picker & { searchText: Record<string, string> }} AgentPicker */
/** @typedef {import('./modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {{ options: { value: string, label: string, hint: string }[], initialValues: string[] }} Picker */

export class Cancelled extends Error {
  name = 'Cancelled'
}

/**
 * @template T
 * @param {T} value
 * @returns {Exclude<T, symbol>}
 */
function ensure(value) {
  if (isCancel(value)) throw new Cancelled()
  return /** @type {Exclude<T, symbol>} */ (/** @type {unknown} */ (value))
}

/**
 * @param {Record<string, any>} messages
 * @param {string} title
 */
export function showIntro(messages, title) {
  intro(title)
  note(message(messages, 'intro'))
}

/**
 * @param {string} text
 * @param {string} [title]
 */
export function showNote(text, title) {
  note(text, title)
}

/** @param {string} text */
export function say(text) {
  log.info(text)
}

/** @param {string} text */
export function warn(text) {
  log.warn(text)
}

/**
 * `cancel` puts the guide prefix in front of the first line only, and most stops here are
 * several lines, so the lines go through `log.error` and `cancel` just closes the guide.
 * @param {string} text
 */
export function fail(text) {
  log.error(text)
  cancel()
}

/**
 * Stopping clears the line: the report that follows says what happened.
 * @param {string} text
 * @returns {{ stop(): void }}
 */
export function startSpinner(text) {
  const active = spinner()
  active.start(text)
  return { stop: () => active.clear() }
}

/**
 * @param {Record<string, any>} messages
 * @param {string} defaultDir
 * @returns {Promise<string>}
 */
export async function askDirectory(messages, defaultDir) {
  const answer = ensure(await text({
    message: message(messages, 'directoryPrompt'),
    placeholder: defaultDir,
    defaultValue: defaultDir,
  }))
  return answer.trim() === '' ? defaultDir : answer.trim()
}

/**
 * @param {string} question
 * @param {boolean} [initial]
 * @returns {Promise<boolean>}
 */
export async function confirm(question, initial = true) {
  return ensure(await confirmPrompt({ message: question, initialValue: initial }))
}

/**
 * @param {Record<string, any>} messages
 * @param {ModuleDefinition} module
 * @param {string[]} installedCodes
 * @param {Record<string, string>} installedVersions
 * @returns {string}
 */
function moduleLabel(messages, module, installedCodes, installedVersions) {
  if (!installedCodes.includes(module.code)) return module.name
  const version = installedVersions[module.code]
  const suffix = version
    ? message(messages, 'installedSuffix', { version })
    : message(messages, 'installedSuffixNoVersion')
  return `${module.name} ${suffix}`
}

/**
 * @param {Record<string, any>} messages
 * @param {ModuleDefinition[]} modules
 * @param {{ installedCodes: string[], installedVersions: Record<string, string> }} options
 * @returns {Picker}
 */
export function modulePicker(messages, modules, options) {
  const { installedCodes, installedVersions } = options
  const fresh = installedCodes.length === 0
  const shown = modules.filter((module) => !module.always)
  return {
    options: shown.map((module) => ({
      value: module.code,
      label: moduleLabel(messages, module, installedCodes, installedVersions),
      hint: module.description,
    })),
    initialValues: shown
      .filter((module) => installedCodes.includes(module.code) || (fresh && module.default))
      .map((module) => module.code),
  }
}

/**
 * @param {Record<string, any>} messages
 * @param {ModuleDefinition[]} modules
 * @param {{ installedCodes: string[], installedVersions: Record<string, string> }} options
 * @returns {Promise<string[]>}
 */
export async function chooseModules(messages, modules, options) {
  return ensure(await multiselect({
    message: message(messages, 'modulesPrompt'),
    ...modulePicker(messages, modules, options),
    required: false,
  }))
}

/**
 * One entry for every agent that reads `.agents/skills`, then the agents with a folder of their own.
 * Preselected entries come first, then the ones found on this machine, then the rest in table order.
 * @param {Record<string, any>} messages
 * @param {Agent[]} agents
 * @param {{ initial: string[], detected: string[], found: string[] }} options
 * @returns {AgentPicker}
 */
export function agentPicker(messages, agents, options) {
  const shared = agents.filter((agent) => isUniversal(agent) && agent.id !== UNIVERSAL_AGENT)
  const names = [
    ...shared.filter((agent) => options.found.includes(agent.id)),
    ...shared.filter((agent) => !options.found.includes(agent.id)),
  ].map((agent) => agent.name)
  const universal = {
    value: UNIVERSAL_AGENT,
    label: message(messages, 'universalLabel'),
    hint: names.length > SHARED_NAMES_SHOWN
      ? message(messages, 'universalHint', { names: names.slice(0, SHARED_NAMES_SHOWN).join(', '), count: names.length - SHARED_NAMES_SHOWN })
      : names.join(', '),
    search: names.join(' '),
  }
  const own = agents.filter((agent) => !isUniversal(agent)).map((agent) => ({
    value: agent.id,
    label: agent.name,
    hint: options.detected.includes(agent.id) ? message(messages, 'agentFoundHint', { dir: agent.skillsDir }) : agent.skillsDir,
    search: '',
  }))
  const rank = (/** @type {string} */ id) => (options.initial.includes(id) ? 0 : options.detected.includes(id) ? 1 : 2)
  const ordered = [universal, ...own].map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry.value) - rank(b.entry.value) || a.index - b.index)
    .map(({ entry }) => entry)
  return {
    options: ordered.map(({ value, label, hint }) => ({ value, label, hint })),
    initialValues: options.initial,
    searchText: Object.fromEntries(ordered.map((entry) => [entry.value, `${entry.value} ${entry.label} ${entry.search}`.toLowerCase()])),
  }
}

/**
 * @param {Record<string, any>} messages
 * @param {Agent[]} agents
 * @param {{ initial: string[], detected: string[], found: string[] }} options
 * @returns {Promise<string[]>}
 */
export async function chooseAgents(messages, agents, options) {
  const { searchText, ...picker } = agentPicker(messages, agents, options)
  return ensure(await autocompleteMultiselect({
    message: message(messages, 'agentsPrompt'),
    placeholder: message(messages, 'agentsPlaceholder'),
    ...picker,
    filter: (search, option) => (searchText[option.value] ?? '').includes(search.trim().toLowerCase()),
    maxItems: 12,
    required: true,
  }))
}

/**
 * @param {Record<string, any>} messages
 * @returns {Promise<'modify' | 'update'>}
 */
export async function chooseExistingAction(messages) {
  /** @type {Array<{ value: 'modify' | 'update', label: string }>} */
  const options = [
    { value: 'modify', label: message(messages, 'existingInstallModify') },
    { value: 'update', label: message(messages, 'existingInstallUpdate') },
  ]
  return ensure(await select({ message: message(messages, 'existingInstallPrompt'), options }))
}

/** @param {string} text */
export function finish(text) {
  outro(text)
}
