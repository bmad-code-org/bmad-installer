import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SkillsCliError,
  addArgv,
  childEnv,
  createSkillsCli,
  listArgv,
  parseAddResults,
  parseListResults,
  skillsCliBin,
  updateArgv,
} from '../src/skills-cli.js'

/** @typedef {import('../src/run.js').RunRequest} RunRequest */
/** @typedef {import('../src/run.js').RunResult} RunResult */

const bin = skillsCliBin()
const metadata = { installer: 'bmad-method', version: '6.13.0-next.0' }

/**
 * @param {Partial<RunResult>[]} canned
 */
function fakeRunner(canned) {
  /** @type {RunRequest[]} */
  const calls = []
  /** @type {import('../src/run.js').Runner} */
  const runner = async (request) => {
    calls.push(request)
    const result = canned[calls.length - 1] ?? canned[canned.length - 1] ?? {}
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result }
  }
  return { runner, calls }
}

/**
 * @param {Partial<RunResult>[]} canned
 * @param {{ telemetry?: boolean, copy?: boolean }} [options]
 */
function fakeCli(canned, options = {}) {
  const { runner, calls } = fakeRunner(canned)
  const cli = createSkillsCli({
    runner,
    env: { PATH: '/usr/bin' },
    telemetry: options.telemetry ?? true,
    copy: options.copy ?? false,
    metadata,
  })
  return { cli, calls }
}

test('skillsCliBin resolves the shipped skills CLI entry point', () => {
  assert.ok(bin.endsWith('skills/bin/cli.mjs'))
})

test('addArgv builds a headless call with metadata after the swallowing flags', () => {
  const argv = addArgv(
    { source: 'owner/repo', skills: ['bmad', 'bmod-method'] },
    { interactive: false, copy: false, metadata },
  )
  assert.deepEqual(argv, [
    process.execPath,
    bin,
    'add',
    'owner/repo',
    '-s',
    'bmad',
    'bmod-method',
    '--metadata',
    JSON.stringify(metadata),
    '-y',
    '--json',
  ])
})

test('addArgv adds -a before --metadata when agents are known', () => {
  const argv = addArgv(
    { source: 'owner/repo', skills: ['bmad'], agents: ['claude-code', 'codex'] },
    { interactive: false, copy: true, metadata },
  )
  assert.deepEqual(argv, [
    process.execPath,
    bin,
    'add',
    'owner/repo',
    '-s',
    'bmad',
    '-a',
    'claude-code',
    'codex',
    '--metadata',
    JSON.stringify(metadata),
    '--copy',
    '-y',
    '--json',
  ])
  assert.ok(argv.indexOf('--metadata') > argv.indexOf('codex'))
})

test('addArgv omits -a for null and empty agent lists', () => {
  const base = { interactive: false, copy: false, metadata }
  assert.ok(!addArgv({ source: 'owner/repo', skills: ['bmad'], agents: null }, base).includes('-a'))
  assert.ok(!addArgv({ source: 'owner/repo', skills: ['bmad'], agents: [] }, base).includes('-a'))
})

test('addArgv interactive omits -y, --json and -a', () => {
  const argv = addArgv(
    { source: 'owner/repo', skills: ['bmad'], agents: ['claude-code'] },
    { interactive: true, copy: false, metadata },
  )
  assert.deepEqual(argv, [
    process.execPath,
    bin,
    'add',
    'owner/repo',
    '-s',
    'bmad',
    '-a',
    'claude-code',
    '--metadata',
    JSON.stringify(metadata),
  ])
})

test('updateArgv and listArgv are fixed', () => {
  assert.deepEqual(updateArgv(), [process.execPath, bin, 'update', '-p', '-y'])
  assert.deepEqual(listArgv(), [process.execPath, bin, 'list', '--json'])
})

test('childEnv sets DO_NOT_TRACK only when telemetry is off and deletes nothing', () => {
  const base = { PATH: '/usr/bin', DO_NOT_TRACK: '1' }
  assert.equal(childEnv({ PATH: '/usr/bin' }, { telemetry: false }).DO_NOT_TRACK, '1')
  assert.equal(childEnv({ PATH: '/usr/bin' }, { telemetry: true }).DO_NOT_TRACK, undefined)
  assert.equal(childEnv(base, { telemetry: true }).DO_NOT_TRACK, '1')
  assert.equal(childEnv(base, { telemetry: true }).PATH, '/usr/bin')
})

test('parseAddResults reads installed, failed and skipped entries', () => {
  const stdout = JSON.stringify([
    { name: 'no-such-skill', status: 'skipped', reason: 'No matching skill found in source' },
    { name: 'bmad', status: 'installed', path: '/p/.claude/skills/bmad', scope: 'project', agents: ['Claude Code'], mode: 'copy' },
    { name: 'bmad-prd', status: 'failed', error: 'Installation failed' },
  ])
  const results = parseAddResults(stdout)
  assert.equal(results.length, 3)
  assert.equal(results[0].reason, 'No matching skill found in source')
  assert.equal(results[1].mode, 'copy')
  assert.equal(results[2].error, 'Installation failed')
})

test('parseAddResults throws SkillsCliError on malformed or non-array stdout', () => {
  assert.throws(() => parseAddResults('not json'), SkillsCliError)
  assert.throws(() => parseAddResults('{"status":"failed"}'), SkillsCliError)
  assert.throws(() => parseAddResults(''), SkillsCliError)
})

test('parseListResults reads listed skills and an empty list', () => {
  const stdout = JSON.stringify([
    { name: 'bmad', path: '/p/.claude/skills/bmad', scope: 'project', agents: ['Claude Code'], source: 'owner/repo' },
  ])
  const listed = parseListResults(stdout)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'bmad')
  assert.equal(listed[0].path, '/p/.claude/skills/bmad')
  assert.deepEqual(parseListResults('[]'), [])
})

test('add runs piped and returns the parsed results', async () => {
  const stdout = JSON.stringify([{ name: 'bmad', status: 'installed' }])
  const { cli, calls } = fakeCli([{ stdout }])
  const results = await cli.add({ source: 'owner/repo', skills: ['bmad'], cwd: '/proj' })

  assert.deepEqual(results, [{ name: 'bmad', status: 'installed' }])
  assert.equal(calls[0].cwd, '/proj')
  assert.equal(calls[0].stdio, 'pipe')
  assert.ok(calls[0].argv.includes('--json'))
})

test('add turns unparsable stdout into one failure with the last stderr line', async () => {
  const { cli } = fakeCli([{ code: 1, stdout: '', stderr: 'Invalid agents: nope\nValid agents: claude-code\n' }])
  const results = await cli.add({ source: 'owner/repo', skills: ['bmad'], cwd: '/proj' })
  assert.deepEqual(results, [{ status: 'failed', error: 'Valid agents: claude-code' }])
})

test('add falls back to the exit code when stderr is empty', async () => {
  const { cli } = fakeCli([{ code: 7, stdout: 'garbage', stderr: '   \n\n' }])
  const results = await cli.add({ source: 'owner/repo', skills: ['bmad'], cwd: '/proj' })
  assert.deepEqual(results, [{ status: 'failed', error: 'skills CLI exited with code 7' }])
})

test('add passes DO_NOT_TRACK and --copy through from the factory', async () => {
  const { cli, calls } = fakeCli([{ stdout: '[]' }], { telemetry: false, copy: true })
  await cli.add({ source: 'owner/repo', skills: ['bmad'], cwd: '/proj' })
  assert.equal(calls[0].env?.DO_NOT_TRACK, '1')
  assert.ok(calls[0].argv.includes('--copy'))
})

test('addInteractive inherits stdio and returns the exit code', async () => {
  const { cli, calls } = fakeCli([{ code: 0 }])
  const result = await cli.addInteractive({ source: 'owner/repo', skills: ['bmad'], cwd: '/proj' })
  assert.deepEqual(result, { code: 0 })
  assert.equal(calls[0].stdio, 'inherit')
  assert.ok(!calls[0].argv.includes('--json'))
})

test('update inherits stdio and returns the exit code', async () => {
  const { cli, calls } = fakeCli([{ code: 1 }])
  const result = await cli.update({ cwd: '/proj' })
  assert.deepEqual(result, { code: 1 })
  assert.equal(calls[0].stdio, 'inherit')
  assert.deepEqual(calls[0].argv, updateArgv())
})

test('list returns [] when the CLI fails with empty stdout', async () => {
  const { cli } = fakeCli([{ code: 1, stdout: '', stderr: 'boom' }])
  assert.deepEqual(await cli.list({ cwd: '/proj' }), [])
})

test('list throws rather than claim an empty project when stdout cannot be read', async () => {
  const truncated = JSON.stringify([{ name: 'bmad', path: '/p/bmad' }]).slice(0, 20)
  const { cli } = fakeCli([{ code: 0, stdout: truncated, stderr: '' }])
  await assert.rejects(() => cli.list({ cwd: '/proj' }), SkillsCliError)

  const { cli: failed } = fakeCli([{ code: 1, stdout: 'not json', stderr: 'boom' }])
  await assert.rejects(() => failed.list({ cwd: '/proj' }), SkillsCliError)
})

test('list parses the listed skills', async () => {
  const stdout = JSON.stringify([{ name: 'bmad', path: '/p/bmad', scope: 'project', agents: [], source: null }])
  const { cli, calls } = fakeCli([{ stdout }])
  const listed = await cli.list({ cwd: '/proj' })
  assert.equal(listed[0].name, 'bmad')
  assert.equal(calls[0].stdio, 'pipe')
})
