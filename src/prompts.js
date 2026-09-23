import {
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
import { message } from './messages.js'

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
 * @param {string} text
 * @returns {{ stop(text?: string): void }}
 */
export function startSpinner(text) {
  const active = spinner()
  active.start(text)
  return { stop: (done) => active.stop(done) }
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
 * @param {ModuleDefinition} module
 * @param {{ installedSkills: string[] }} options
 * @returns {Picker}
 */
export function bundlePicker(module, options) {
  const bundles = module.bundles ?? []
  const installed = new Set(options.installedSkills)
  return {
    options: bundles.map((bundle) => ({ value: bundle.code, label: bundle.name, hint: bundle.description })),
    initialValues: bundles
      .filter((bundle) => bundle.default || bundle.skills.every((skill) => installed.has(skill)))
      .map((bundle) => bundle.code),
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
 * @param {Record<string, any>} messages
 * @param {ModuleDefinition} module
 * @param {{ installedSkills: string[] }} options
 * @returns {Promise<string[]>}
 */
export async function chooseBundles(messages, module, options) {
  return ensure(await multiselect({
    message: message(messages, 'bundlesPrompt', { module: module.name }),
    ...bundlePicker(module, options),
    required: false,
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
