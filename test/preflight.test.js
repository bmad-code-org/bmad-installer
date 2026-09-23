import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PreflightError,
  hasTerminal,
  nodeVersionState,
  runPreflight,
  uvVersion,
  wslRunningWindowsNode,
} from '../src/preflight.js'

/** @typedef {import('../src/run.js').RunRequest} RunRequest */
/** @typedef {import('../src/run.js').RunResult} RunResult */
/** @typedef {import('../src/run.js').Runner} Runner */

const messages = {
  nodeTooOld: 'Node {version} is too old.',
  nodeBelowSkillsFloor: 'Node {version} is below the floor.',
  wslWindowsNode: 'Windows Node was launched from a WSL shell.',
  uvMissing: 'uv is missing. Install it with {installCommand}',
  uvInstall: { darwin: 'brew install uv', linux: 'curl uv', win32: 'irm uv' },
  needsTerminal: 'This needs a terminal.',
  insideAgent: 'Running inside {agent}.',
}

/**
 * @param {Partial<RunResult>} result
 * @param {RunRequest[]} [calls]
 * @returns {Runner}
 */
function fakeRunner(result, calls = []) {
  return async (request) => {
    calls.push(request)
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result }
  }
}

/** @returns {Runner} */
function uvOk() {
  return fakeRunner({ code: 0, stdout: 'uv 0.5.31\n' })
}

test('nodeVersionState maps versions to states', () => {
  /** @type {Array<[string, 'ok' | 'warn' | 'too-old']>} */
  const table = [
    ['18.20.8', 'too-old'],
    ['20.11.1', 'too-old'],
    ['21.9.0', 'too-old'],
    ['22.0.0', 'warn'],
    ['22.13.0', 'warn'],
    ['22.19.99', 'warn'],
    ['22.20.0', 'ok'],
    ['22.21.1', 'ok'],
    ['23.1.0', 'ok'],
    ['v24.0.0', 'ok'],
  ]
  for (const [version, expected] of table) {
    assert.equal(nodeVersionState(version), expected, version)
  }
})

test('nodeVersionState defaults to the running node', () => {
  assert.equal(nodeVersionState(), nodeVersionState(process.versions.node))
})

test('wslRunningWindowsNode follows the WSL rules', () => {
  const base = { platform: 'win32', env: {}, cwd: 'C:\\project', execPath: 'C:\\Program Files\\nodejs\\node.exe' }
  /** @type {Array<[string, { platform: string, env: NodeJS.ProcessEnv, cwd: string, execPath: string }, boolean]>} */
  const table = [
    ['plain windows', base, false],
    ['distro name', { ...base, env: { WSL_DISTRO_NAME: 'Ubuntu' } }, true],
    ['interop socket', { ...base, env: { WSL_INTEROP: '/run/WSL/12_interop' } }, true],
    ['linux PWD', { ...base, env: { PWD: '/home/me/project' } }, true],
    ['windows PWD', { ...base, env: { PWD: 'C:\\project' } }, false],
    ['unc wsl$ cwd', { ...base, cwd: '\\\\wsl$\\Ubuntu\\home\\me\\project' }, true],
    ['unc wsl.localhost cwd', { ...base, cwd: '\\\\wsl.localhost\\Ubuntu\\home\\me' }, true],
    ['unc wsl cwd', { ...base, cwd: '\\\\wsl\\Ubuntu\\home\\me' }, true],
    ['other unc cwd', { ...base, cwd: '\\\\server\\share\\project' }, false],
    ['wsl$ execPath', { ...base, execPath: '\\\\wsl$\\Ubuntu\\usr\\bin\\node' }, true],
    ['wsl.localhost execPath', { ...base, execPath: '\\\\wsl.localhost\\Ubuntu\\usr\\bin\\node' }, true],
    ['darwin with wsl env', { ...base, platform: 'darwin', env: { WSL_DISTRO_NAME: 'Ubuntu' } }, false],
    ['linux with wsl env', { ...base, platform: 'linux', env: { WSL_INTEROP: '/run/WSL/12_interop' } }, false],
  ]
  for (const [name, input, expected] of table) {
    assert.equal(wslRunningWindowsNode(input), expected, name)
  }
})

test('uvVersion parses the version and asks uv once', async () => {
  /** @type {RunRequest[]} */
  const calls = []
  const runner = fakeRunner({ code: 0, stdout: 'uv 0.5.31 (abc1234 2026-01-01)\n' }, calls)
  assert.equal(await uvVersion(runner), '0.5.31')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].argv, ['uv', '--version'])
  assert.equal(calls[0].timeoutMs, 5000)
})

test('uvVersion accepts a two part version', async () => {
  assert.equal(await uvVersion(fakeRunner({ code: 0, stdout: 'uv 0.9\n' })), '0.9')
})

test('uvVersion returns null when uv is missing, fails or is unreadable', async () => {
  assert.equal(await uvVersion(fakeRunner({ code: null, error: 'spawn uv ENOENT' })), null)
  assert.equal(await uvVersion(fakeRunner({ code: 1, stderr: 'boom' })), null)
  assert.equal(await uvVersion(fakeRunner({ code: 0, stdout: 'not a version\n' })), null)
  assert.equal(await uvVersion(fakeRunner({ code: null, timedOut: true })), null)
})

test('hasTerminal needs both streams to be a TTY', () => {
  const tty = /** @type {any} */ ({ isTTY: true })
  const pipe = /** @type {any} */ ({ isTTY: false })
  const unknown = /** @type {any} */ ({})
  assert.equal(hasTerminal(tty, tty), true)
  assert.equal(hasTerminal(pipe, tty), false)
  assert.equal(hasTerminal(tty, pipe), false)
  assert.equal(hasTerminal(unknown, tty), false)
})

test('runPreflight passes when uv answers', async () => {
  /** @type {string[]} */
  const warnings = []
  await runPreflight({
    interactive: false,
    runner: uvOk(),
    messages,
    warn: (text) => warnings.push(text),
    platform: 'darwin',
  })
  assert.equal(warnings.length, nodeVersionState() === 'warn' ? 1 : 0)
  if (warnings.length === 1) assert.ok(warnings[0].includes(process.versions.node))
})

test('runPreflight stops with the platform install command when uv is missing', async () => {
  await assert.rejects(
    () => runPreflight({
      interactive: false,
      runner: fakeRunner({ code: null, error: 'spawn uv ENOENT' }),
      messages,
      warn: () => {},
      platform: 'darwin',
    }),
    (error) => error instanceof PreflightError && error.message === 'uv is missing. Install it with brew install uv',
  )
})

test('runPreflight falls back to the linux install command', async () => {
  await assert.rejects(
    () => runPreflight({
      interactive: false,
      runner: fakeRunner({ code: 1 }),
      messages,
      warn: () => {},
      platform: 'freebsd',
    }),
    (error) => error instanceof PreflightError && error.message === 'uv is missing. Install it with curl uv',
  )
})

test('runPreflight stops a Windows node launched from a WSL shell', async () => {
  process.env.WSL_DISTRO_NAME = 'Ubuntu'
  try {
    await assert.rejects(
      () => runPreflight({ interactive: false, runner: uvOk(), messages, warn: () => {}, platform: 'win32' }),
      (error) => error instanceof PreflightError && error.message === messages.wslWindowsNode,
    )
  } finally {
    delete process.env.WSL_DISTRO_NAME
  }
})

test('runPreflight requires a terminal for an interactive run', async (t) => {
  if (hasTerminal()) return t.skip('attached to a terminal')
  await assert.rejects(
    () => runPreflight({ interactive: true, runner: uvOk(), messages, warn: () => {}, platform: 'darwin' }),
    (error) => error instanceof PreflightError && error.message === messages.needsTerminal,
  )
})
