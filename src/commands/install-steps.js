import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { message } from '../messages.js'
import { defaultCodes, parseModulesFlag } from '../modules.js'
import { Cancelled } from '../prompts.js'
import { distTag, newerVersion } from '../self-update.js'

/** @typedef {import('../cli.js').CliOptions} CliOptions */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */
/** @typedef {import('./existing-install.js').Existing} Existing */
/** @typedef {import('./install-plan.js').ReplacedInstall} ReplacedInstall */

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
  const exists = await isDirectory(directory)

  const question = exists ? 'directoryConfirm' : 'directoryCreateConfirm'
  if (interactive && !(await prompts.confirm(message(messages, question, { directory })))) throw new Cancelled()
  if (!exists) await mkdir(directory, { recursive: true })
  return directory
}

/**
 * `--modules` wins, then `--yes` takes the defaults, then the picker asks.
 * @param {CliOptions} options
 * @param {CommandDeps} deps
 * @param {Existing} existing
 * @returns {Promise<string[]>}
 */
export async function pickModuleCodes(options, deps, existing) {
  const { messages, modules, prompts } = deps
  if (options.modules) return parseModulesFlag(options.modules, modules)
  if (options.yes) return defaultCodes(modules)
  return prompts.chooseModules(messages, modules, {
    installedCodes: existing.codes,
    installedVersions: existing.versions,
  })
}

/**
 * Says, for each retired module still installed, which module replaces it and that bmad setup removes it.
 * @param {CommandDeps} deps
 * @param {ReplacedInstall[]} replaced
 */
export function warnReplaced(deps, replaced) {
  for (const entry of replaced) {
    deps.prompts.warn(message(deps.messages, 'replacedModule', entry))
  }
}
