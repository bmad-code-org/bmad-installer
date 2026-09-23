import { determineAgent } from '@vercel/detect-agent'
import { message } from './messages.js'

/** @typedef {import('./run.js').Runner} Runner */

const UV_TIMEOUT_MS = 5000
const NODE_MAJOR_FLOOR = 22
const SKILLS_CLI_MINOR_FLOOR = 20
const WSL_PATH_PATTERN = /^\\\\wsl(\.localhost|\$)?\\/
const WSL_EXEC_PATHS = ['\\wsl$\\', '\\wsl.localhost\\']
const UV_VERSION_PATTERN = /uv\s+(\d+\.\d+(?:\.\d+)?)/

export class PreflightError extends Error {
  name = 'PreflightError'
}

/**
 * @param {string} [version]
 * @returns {'ok' | 'warn' | 'too-old'}
 */
export function nodeVersionState(version = process.versions.node) {
  const [major, minor] = version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(major) || major < NODE_MAJOR_FLOOR) return 'too-old'
  if (major === NODE_MAJOR_FLOOR && (!Number.isFinite(minor) || minor < SKILLS_CLI_MINOR_FLOOR)) return 'warn'
  return 'ok'
}

/**
 * @param {{ platform: string, env: NodeJS.ProcessEnv, cwd: string, execPath: string }} [input]
 * @returns {boolean}
 */
export function wslRunningWindowsNode(input) {
  const { platform, env, cwd, execPath } = input ?? {
    platform: process.platform,
    env: process.env,
    cwd: process.cwd(),
    execPath: process.execPath,
  }
  if (platform !== 'win32') return false
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  if (env.PWD?.startsWith('/')) return true
  if (WSL_PATH_PATTERN.test(cwd)) return true
  return WSL_EXEC_PATHS.some((fragment) => execPath.includes(fragment))
}

/**
 * @param {Runner} runner
 * @returns {Promise<string | null>}
 */
export async function uvVersion(runner) {
  const result = await runner({ argv: ['uv', '--version'], timeoutMs: UV_TIMEOUT_MS })
  if (result.code !== 0) return null
  const match = UV_VERSION_PATTERN.exec(result.stdout)
  return match ? match[1] : null
}

/** @returns {Promise<string | null>} */
export async function insideAgent() {
  const result = await determineAgent()
  return result.isAgent ? result.agent.name : null
}

/**
 * @param {NodeJS.ReadStream} [stdin]
 * @param {NodeJS.WriteStream} [stdout]
 * @returns {boolean}
 */
export function hasTerminal(stdin = process.stdin, stdout = process.stdout) {
  return Boolean(stdin?.isTTY && stdout?.isTTY)
}

/**
 * @param {Record<string, any>} messages
 * @param {string} [platform]
 * @returns {string}
 */
export function uvInstallCommand(messages, platform = process.platform) {
  const commands = messages.uvInstall ?? {}
  return String(commands[platform] ?? commands.linux ?? '')
}

/**
 * `terminal` and `agent` are injectable so the command tests can drive the interactive path.
 * @param {{ interactive: boolean, runner: Runner, messages: Record<string, any>, warn: (text: string) => void, platform?: string, terminal?: () => boolean, agent?: () => Promise<string | null> }} options
 * @returns {Promise<void>}
 */
export async function runPreflight(options) {
  const {
    interactive,
    runner,
    messages,
    warn,
    platform = process.platform,
    terminal = hasTerminal,
    agent: readAgent = insideAgent,
  } = options
  const version = process.versions.node
  const state = nodeVersionState(version)
  if (state === 'too-old') throw new PreflightError(message(messages, 'nodeTooOld', { version }))
  if (state === 'warn') warn(message(messages, 'nodeBelowSkillsFloor', { version }))

  const wsl = wslRunningWindowsNode({ platform, env: process.env, cwd: process.cwd(), execPath: process.execPath })
  if (wsl) throw new PreflightError(message(messages, 'wslWindowsNode'))

  const uv = await uvVersion(runner)
  if (uv === null) {
    throw new PreflightError(message(messages, 'uvMissing', { installCommand: uvInstallCommand(messages, platform) }))
  }

  if (!interactive) return

  if (!terminal()) throw new PreflightError(message(messages, 'needsTerminal'))

  const agent = await readAgent()
  if (agent) throw new PreflightError(message(messages, 'insideAgent', { agent }))
}
