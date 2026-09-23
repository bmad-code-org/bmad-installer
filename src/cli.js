import { parseArgs } from 'node:util'
import { createBmadScripts } from './bmad-scripts.js'
import { install } from './commands/install.js'
import { status } from './commands/status.js'
import { update } from './commands/update.js'
import { MessagesError, loadMessages, message } from './messages.js'
import { ModulesError, loadModules } from './modules.js'
import { PreflightError } from './preflight.js'
import * as prompts from './prompts.js'
import { createRunner } from './run.js'
import { createSkillsCli } from './skills-cli.js'
import { version } from './version.js'

/** @typedef {{ command: 'install' | 'update' | 'status', directory?: string, modules?: string, tools?: string, yes: boolean, telemetry: boolean, copy: boolean, debug: boolean }} CliOptions */
/** @typedef {{ stdout: NodeJS.WriteStream, stderr: NodeJS.WriteStream, env: NodeJS.ProcessEnv, cwd: string }} Io */

const OPTIONS = /** @type {const} */ ({
  directory: { type: 'string', short: 'd' },
  modules: { type: 'string', short: 'm' },
  tools: { type: 'string', short: 't' },
  yes: { type: 'boolean', short: 'y' },
  action: { type: 'string' },
  copy: { type: 'boolean' },
  debug: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
})

const DROPPED_FLAGS = new Set([
  'custom-source', 'set', 'list-options', 'user-name', 'communication-language',
  'document-output-language', 'output-folder', 'channel', 'all-stable', 'all-next',
  'next', 'pin', 'shims', 'no-shims', 'list-tools',
])
const KNOWN_FLAGS = new Set([...Object.keys(OPTIONS), 'no-telemetry'])
const COMMANDS = new Set(['install', 'update', 'status'])
/** @type {Record<string, 'install' | 'update'>} */
const ACTIONS = { install: 'install', update: 'update', 'quick-update': 'update' }
const DROPPED_COMMAND = 'uninstall'
const INSTALLER_NAME = 'bmad-method'
const HELP_HINT = 'Run bmad-method --help for the list of flags.'

const HELP = `bmad-method [install|update|status] [flags]

Commands
  install                   Install BMad modules into a project (the default)
  update                    Update the BMad skills already installed
  status                    Show what is installed and what is still missing

Flags
  -d, --directory <path>    Project directory, default the current one
  -m, --modules <spec>      Modules to install, e.g. method:planning+build,cis
  -t, --tools <ids>         Comma-separated skills CLI agent ids to install to
  -y, --yes                 Take the defaults and ask nothing
      --action <name>       install, update or quick-update, for 6.12 scripts
      --no-telemetry        Turn off skills CLI telemetry and the skills.sh install counts
      --copy                Copy skills instead of linking, if symlinks fail on your system
      --debug               Print every child command, its cwd and its output to stderr
  -h, --help                Show this help
  -v, --version             Show the version`

export class UsageError extends Error {
  name = 'UsageError'
}

/** @returns {string} */
export function helpText() {
  return HELP
}

/**
 * @param {Record<string, unknown>} values
 * @param {string} name
 * @returns {string | undefined}
 */
function textValue(values, name) {
  const value = values[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new UsageError(`--${name} needs a value`)
  return value
}

/**
 * Non-strict parsing stores `--copy=true` as the string "true", so presence among the tokens,
 * not the parsed value, decides a boolean flag.
 * @param {{ name: string }[]} flags
 * @param {string} name
 * @returns {boolean}
 */
function flagGiven(flags, name) {
  return flags.some((flag) => flag.name === name)
}

/**
 * @param {Record<string, unknown>} values
 * @param {string[]} positionals
 * @returns {'install' | 'update' | 'status'}
 */
function readCommand(values, positionals) {
  const [first, ...rest] = positionals
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`)
  if (first !== undefined && !COMMANDS.has(first)) throw new UsageError(`unknown command ${first}`)
  const action = textValue(values, 'action')
  if (action === undefined) return /** @type {'install' | 'update' | 'status'} */ (first ?? 'install')
  const mapped = ACTIONS[action]
  if (!mapped) throw new UsageError(`unknown --action ${action}`)
  return mapped
}

/**
 * Dropped flags are read from the tokens before anything else, so a 6.12 command line
 * explains itself instead of failing on a stray positional.
 * @param {string[]} argv
 * @param {Record<string, any>} messages
 * @returns {{ kind: 'run', options: CliOptions } | { kind: 'help' } | { kind: 'version' } | { kind: 'dropped', text: string }}
 */
export function parseCli(argv, messages) {
  const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false, tokens: true })
  const values = /** @type {Record<string, unknown>} */ (parsed.values)
  const flags = (parsed.tokens ?? []).flatMap((token) => (token.kind === 'option' ? [token] : []))

  const dropped = flags.filter((flag) => DROPPED_FLAGS.has(flag.name))
  if (dropped.length > 0) {
    return { kind: 'dropped', text: dropped.map((flag) => message(messages, `droppedFlags.${flag.name}`)).join('\n') }
  }
  if (parsed.positionals.includes(DROPPED_COMMAND)) {
    return { kind: 'dropped', text: message(messages, 'droppedUninstall') }
  }

  const unknown = flags.find((flag) => !KNOWN_FLAGS.has(flag.name))
  if (unknown) throw new UsageError(`unknown flag ${unknown.rawName}`)

  if (flagGiven(flags, 'help')) return { kind: 'help' }
  if (flagGiven(flags, 'version')) return { kind: 'version' }

  return {
    kind: 'run',
    options: {
      command: readCommand(values, parsed.positionals),
      directory: textValue(values, 'directory'),
      modules: textValue(values, 'modules'),
      tools: textValue(values, 'tools'),
      yes: flagGiven(flags, 'yes'),
      telemetry: !flagGiven(flags, 'no-telemetry'),
      copy: flagGiven(flags, 'copy'),
      debug: flagGiven(flags, 'debug'),
    },
  }
}

/**
 * @param {unknown} err
 * @param {Io} io
 * @param {{ debug: boolean, messages: Record<string, any> | null }} context
 * @returns {number}
 */
function reportError(err, io, context) {
  if (err instanceof prompts.Cancelled && context.messages) {
    prompts.fail(message(context.messages, 'cancelled'))
    return 1
  }
  if (err instanceof PreflightError) {
    prompts.fail(err.message)
    return 1
  }
  if (err instanceof UsageError) {
    io.stderr.write(`${err.message}\n${HELP_HINT}\n`)
    return 2
  }
  if (err instanceof MessagesError || err instanceof ModulesError) {
    io.stderr.write(`${err.message}\n`)
    return 1
  }
  const detail = err instanceof Error ? ((context.debug && err.stack) || err.message) : String(err)
  io.stderr.write(`${detail}\n`)
  return 1
}

/**
 * @param {string[]} argv
 * @param {Io} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io) {
  const out = io ?? { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd() }
  /** @type {Record<string, any> | null} */
  let messages = null
  let debug = false

  try {
    messages = await loadMessages()
    const parsed = parseCli(argv, messages)
    if (parsed.kind === 'help') {
      out.stdout.write(`${helpText()}\n`)
      return 0
    }
    if (parsed.kind === 'version') {
      out.stdout.write(`${version}\n`)
      return 0
    }
    if (parsed.kind === 'dropped') {
      out.stderr.write(`${parsed.text}\n`)
      return 2
    }

    const options = parsed.options
    debug = options.debug
    const modules = await loadModules()
    const runner = createRunner({ debug, log: (line) => out.stderr.write(`${line}\n`) })
    const deps = {
      runner,
      skillsCli: createSkillsCli({
        runner,
        env: out.env,
        telemetry: options.telemetry,
        copy: options.copy,
        metadata: { installer: INSTALLER_NAME, version },
      }),
      bmadScripts: createBmadScripts({ runner }),
      messages,
      modules,
      prompts,
      env: out.env,
      cwd: out.cwd,
      version,
    }

    if (options.command === 'update') return await update(options, deps)
    if (options.command === 'status') return await status(options, deps)
    return await install(options, deps)
  } catch (err) {
    return reportError(err, out, { debug, messages })
  }
}
