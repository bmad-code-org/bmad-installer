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
import { UNIVERSAL_AGENT } from './agents.js'
import { message } from './messages.js'


/** @typedef {import('./agents.js').Agent} Agent */
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
  log.message(message(messages, 'intro'))
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

/**
 * Plain lines on the guide bar, with no icon.
 * @param {string} text
 */
export function plain(text) {
  log.message(text)
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
 * Stopping clears the line: the report that follows says what happened. One spinner can carry
 * several steps with `update`, so a run leaves one blank line, not one per step.
 * @param {string} text
 * @returns {{ stop(): void, update(text: string): void }}
 */
export function startSpinner(text) {
  const active = spinner()
  active.start(text)
  return { stop: () => active.clear(), update: (next) => active.message(next) }
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
 * Every agent under its own name; the skills CLI writes `.agents/skills` once however many of the
 * agents that share it are picked. Preselected agents come first, then the ones found on this
 * machine, then the rest in table order.
 * @param {Record<string, any>} messages
 * @param {Agent[]} agents
 * @param {{ initial: string[], found: string[] }} options
 * @returns {Picker}
 */
export function agentPicker(messages, agents, options) {
  const rank = (/** @type {Agent} */ agent) => (options.initial.includes(agent.id) ? 0 : options.found.includes(agent.id) ? 1 : 2)
  const ordered = agents
    .filter((agent) => agent.id !== UNIVERSAL_AGENT)
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => rank(a.agent) - rank(b.agent) || a.index - b.index)
    .map(({ agent }) => agent)
  return {
    // clack shows a hint only on the highlighted row, so "found" goes in the label.
    options: ordered.map((agent) => ({
      value: agent.id,
      label: options.found.includes(agent.id) ? message(messages, 'agentFoundLabel', { name: agent.name }) : agent.name,
      hint: agent.skillsDir,
    })),
    initialValues: options.initial,
  }
}

/**
 * @param {Record<string, any>} messages
 * @param {Agent[]} agents
 * @param {{ initial: string[], found: string[] }} options
 * @returns {Promise<string[]>}
 */
export async function chooseAgents(messages, agents, options) {
  const picker = agentPicker(messages, agents, options)
  const search = Object.fromEntries(agents.map((agent) => [agent.id, `${agent.id} ${agent.name}`.toLowerCase()]))
  return ensure(await autocompleteMultiselect({
    message: message(messages, 'agentsPrompt'),
    placeholder: message(messages, 'agentsPlaceholder'),
    ...picker,
    filter: (query, option) => (search[option.value] ?? '').includes(query.trim().toLowerCase()),
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
