import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UsageError, helpText, main, parseCli, reportError, toolsText } from '../src/cli.js'
import { BmadScriptsError } from '../src/bmad-scripts.js'
import { loadAgents } from '../src/agents.js'
import { loadMessages } from '../src/messages.js'
import { version } from '../src/version.js'

const messages = await loadMessages()

/** @param {string[]} argv */
function run(argv) {
  const parsed = parseCli(argv, messages)
  assert.equal(parsed.kind, 'run')
  return parsed.kind === 'run' ? parsed.options : assert.fail('not a run')
}

/** @param {string[]} argv */
function dropped(argv) {
  const parsed = parseCli(argv, messages)
  assert.equal(parsed.kind, 'dropped')
  return parsed.kind === 'dropped' ? parsed.text : assert.fail('not dropped')
}

function fakeIo() {
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  const err = []
  const io = {
    stdout: /** @type {NodeJS.WriteStream} */ (/** @type {any} */ ({ write: (/** @type {string} */ t) => out.push(t) })),
    stderr: /** @type {NodeJS.WriteStream} */ (/** @type {any} */ ({ write: (/** @type {string} */ t) => err.push(t) })),
    env: /** @type {NodeJS.ProcessEnv} */ ({}),
    cwd: process.cwd(),
  }
  return { io, out, err }
}

test('no arguments installs into the current directory with telemetry on', () => {
  assert.deepEqual(run([]), {
    command: 'install',
    directory: undefined,
    modules: undefined,
    tools: undefined,
    yes: false,
    telemetry: true,
    copy: false,
    debug: false,
  })
})

test('every flag is read, long and short', () => {
  const long = run([
    'install',
    '--directory', '/tmp/p',
    '--modules', 'method,cis',
    '--tools', 'claude-code,codex',
    '--yes',
    '--no-telemetry',
    '--copy',
    '--debug',
  ])
  assert.deepEqual(long, {
    command: 'install',
    directory: '/tmp/p',
    modules: 'method,cis',
    tools: 'claude-code,codex',
    yes: true,
    telemetry: false,
    copy: true,
    debug: true,
  })

  const short = run(['-d', '/tmp/p', '-m', 'cis', '-t', 'codex', '-y'])
  assert.equal(short.directory, '/tmp/p')
  assert.equal(short.modules, 'cis')
  assert.equal(short.tools, 'codex')
  assert.equal(short.yes, true)
})

test('a boolean flag written with = still counts as given', () => {
  const equals = run(['--no-telemetry=1', '--copy=true', '--debug=true', '--yes=true'])
  assert.equal(equals.telemetry, false)
  assert.equal(equals.copy, true)
  assert.equal(equals.debug, true)
  assert.equal(equals.yes, true)

  assert.equal(run(['--no-telemetry=']).telemetry, false)
  assert.deepEqual(parseCli(['--help=1'], messages), { kind: 'help' })
  assert.deepEqual(parseCli(['--version=1'], messages), { kind: 'version' })
})

test('update and status are commands', () => {
  assert.equal(run(['update']).command, 'update')
  assert.equal(run(['status']).command, 'status')
})

test('--action maps the 6.12 values onto the commands', () => {
  assert.equal(run(['--action', 'install']).command, 'install')
  assert.equal(run(['--action', 'update']).command, 'update')
  assert.equal(run(['--action', 'quick-update']).command, 'update')
  assert.throws(() => parseCli(['--action', 'remove'], messages), UsageError)
})

test('unknown flags, commands and stray arguments are usage errors', () => {
  assert.throws(() => parseCli(['--bogus'], messages), UsageError)
  assert.throws(() => parseCli(['-q'], messages), UsageError)
  assert.throws(() => parseCli(['reinstall'], messages), UsageError)
  assert.throws(() => parseCli(['install', 'extra'], messages), UsageError)
  assert.throws(() => parseCli(['--directory'], messages), UsageError)
})

test('every dropped 6.12 flag explains itself', () => {
  const flags = [
    'custom-source', 'set', 'list-options', 'user-name', 'communication-language',
    'document-output-language', 'output-folder', 'channel', 'all-stable', 'all-next',
    'next', 'pin', 'shims', 'no-shims',
  ]
  for (const flag of flags) {
    const text = dropped([`--${flag}`])
    assert.equal(text, messages.droppedFlags[flag])
    assert.ok(text.startsWith(`--${flag} `))
  }
})

test('dropped flags are read before the arguments they swallowed', () => {
  assert.equal(dropped(['--custom-source', 'owner/repo']), messages.droppedFlags['custom-source'])
  assert.equal(dropped(['install', '--next', '--bogus']), messages.droppedFlags.next)
  const both = dropped(['--pin', '6.12.0', '--shims'])
  assert.deepEqual(both.split('\n'), [messages.droppedFlags.pin, messages.droppedFlags.shims])
})

test('uninstall is dropped too', () => {
  assert.equal(dropped(['uninstall']), messages.droppedUninstall)
})

test('help and version win over a command', () => {
  assert.deepEqual(parseCli(['--help'], messages), { kind: 'help' })
  assert.deepEqual(parseCli(['-h'], messages), { kind: 'help' })
  assert.deepEqual(parseCli(['install', '--version'], messages), { kind: 'version' })
  assert.deepEqual(parseCli(['-v'], messages), { kind: 'version' })
})

test('helpText lists every command and flag on one line each', () => {
  const text = helpText()
  for (const name of ['install', 'update', 'status', '--directory', '--modules', '--tools', '--list-tools', '--yes',
    '--action', '--no-telemetry', '--copy', '--debug', '--help', '--version']) {
    assert.ok(text.includes(name), `missing ${name}`)
  }
  assert.ok(/--no-telemetry .*skills\.sh install counts/.test(text))
  assert.ok(/--copy .*symlinks fail on your system/.test(text))
  assert.ok(text.split('\n').every((line) => line.length <= 100))
})

test('main prints the help and exits 0', async () => {
  const { io, out } = fakeIo()
  assert.equal(await main(['--help'], io), 0)
  assert.equal(out.join(''), `${helpText()}\n`)
})

test('main prints the version and exits 0', async () => {
  const { io, out } = fakeIo()
  assert.equal(await main(['--version'], io), 0)
  assert.equal(out.join(''), `${version}\n`)
})

test('main writes dropped flags to stderr and exits 2', async () => {
  const { io, out, err } = fakeIo()
  assert.equal(await main(['--channel', 'next'], io), 2)
  assert.equal(err.join(''), `${messages.droppedFlags.channel}\n`)
  assert.equal(out.length, 0)
})

test('main rejects an unknown --tools id before it prints anything else', async () => {
  const { io, out, err } = fakeIo()
  assert.equal(await main(['-y', '-t', 'claude-code,nope'], io), 2)
  assert.equal(err.join(''), `${messages.unknownTools.replace('{ids}', 'nope')}\n`)
  assert.equal(out.length, 0)
})

test('main rejects an unknown --modules code before it prints anything else', async () => {
  const { io, out, err } = fakeIo()
  assert.equal(await main(['-y', '-m', 'method,nope', '-t', 'claude-code'], io), 2)
  assert.ok(err.join('').startsWith('Unknown module: nope\nModules: method, toolsmith, founder, tea, cis, or a folder'), err.join(''))
  assert.equal(out.length, 0)
})

test('main writes a usage error with a help hint and exits 2', async () => {
  const { io, err } = fakeIo()
  assert.equal(await main(['--bogus'], io), 2)
  assert.ok(err.join('').includes('unknown flag --bogus'))
  assert.ok(err.join('').includes('--help'))
})

test('--list-tools prints one line per agent with its id and skills folder', async () => {
  assert.deepEqual(parseCli(['--list-tools'], messages), { kind: 'listTools' })
  const agents = await loadAgents()
  const lines = toolsText(agents).split('\n')
  assert.equal(lines.length, agents.length)
  const claude = lines.find((line) => line.startsWith('claude-code '))
  assert.ok(claude?.includes('Claude Code') && claude.endsWith('.claude/skills'))
})

test('a failing bmad script shows what the script wrote, not just its exit code', () => {
  const { io, err } = fakeIo()
  const failure = new BmadScriptsError('setup.py --status exited with 1', 'Traceback (most recent call last):\nValueError: bad bmod.toml\n')
  assert.equal(reportError(failure, io, { debug: false, messages }), 1)
  assert.equal(err.join(''), 'setup.py --status exited with 1\nTraceback (most recent call last):\nValueError: bad bmod.toml\n')
})
