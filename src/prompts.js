import { styleText } from 'node:util'
import {
  autocompleteMultiselect,
  box,
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
import { installedLabel } from './report.js'

const WIDE_LOGO_COLUMNS = 101
const NARROW_LOGO_COLUMNS = 48

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

/** @param {Record<string, any>} messages */
export function showIntro(messages) {
  const columns = process.stdout.columns || 80
  if (columns >= NARROW_LOGO_COLUMNS) showLogo(messages, columns)
  intro(message(messages, 'title'))
  log.message(message(messages, 'intro'))
}

/**
 * @param {Record<string, any>} messages
 * @param {number} columns
 */
function showLogo(messages, columns) {
  const lines = message(messages, columns >= WIDE_LOGO_COLUMNS ? 'logoWide' : 'logoNarrow').split('\n')
  const width = Math.max(...lines.map((line) => line.length))
  // Padded to one width so the centred box keeps the letters aligned.
  const logo = lines.map((line) => styleText('blue', line.padEnd(width))).join('\n')
  box(`${logo}\n\n${styleText('dim', message(messages, 'credit'))}`, '', {
    contentAlign: 'center',
    width: 'auto',
    rounded: true,
    withGuide: false,
    formatBorder: (text) => styleText('blue', text),
  })
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
      label: installedCodes.includes(module.code) ? installedLabel(messages, module.name, installedVersions[module.code]) : module.name,
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
 * agents that share it are picked. Preselected agents come first, then the rest by name.
 * Nothing is marked as installed: an agent's config folder often outlives the agent.
 * @param {Agent[]} agents
 * @param {{ initial: string[] }} options
 * @returns {Picker}
 */
export function agentPicker(agents, options) {
  const listed = agents
    .filter((agent) => agent.id !== UNIVERSAL_AGENT)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const ordered = [
    ...listed.filter((agent) => options.initial.includes(agent.id)),
    ...listed.filter((agent) => !options.initial.includes(agent.id)),
  ]
  return {
    options: ordered.map((agent) => ({ value: agent.id, label: agent.name, hint: agent.skillsDir })),
    initialValues: options.initial,
  }
}

/**
 * @param {Record<string, any>} messages
 * @param {Agent[]} agents
 * @param {{ initial: string[] }} options
 * @returns {Promise<string[]>}
 */
export async function chooseAgents(messages, agents, options) {
  const picker = agentPicker(agents, options)
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
