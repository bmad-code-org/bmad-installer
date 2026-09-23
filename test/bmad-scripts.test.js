import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BmadScriptsError,
  createBmadScripts,
  knowledgeArgv,
  parseMigrations,
  parseStatus,
  setupStatusArgv,
} from '../src/bmad-scripts.js'

/** @typedef {import('../src/run.js').RunRequest} RunRequest */
/** @typedef {import('../src/run.js').RunResult} RunResult */

const SKILLS_DIR = '/project/.agents/skills'
const BMAD_DIR = join(SKILLS_DIR, 'bmad')
const PROJECT = '/project'

/** @param {string} name */
function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/**
 * @param {Partial<RunResult>[]} results
 */
function fakeRunner(results) {
  /** @type {RunRequest[]} */
  const calls = []
  let index = 0
  /** @type {import('../src/run.js').Runner} */
  const runner = async (request) => {
    calls.push(request)
    const result = results[Math.min(index, results.length - 1)]
    index += 1
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result }
  }
  return { runner, calls }
}

test('setupStatusArgv builds the uv command', () => {
  assert.deepEqual(setupStatusArgv(BMAD_DIR, PROJECT), [
    'uv',
    'run',
    '--no-cache',
    join(BMAD_DIR, 'scripts', 'setup.py'),
    '--project-root',
    PROJECT,
    '--skill',
    BMAD_DIR,
    '--status',
  ])
})

test('knowledgeArgv points --root at the skills directory', () => {
  assert.deepEqual(knowledgeArgv(BMAD_DIR), [
    'uv',
    'run',
    '--no-cache',
    join(BMAD_DIR, 'scripts', 'knowledge.py'),
    '--root',
    SKILLS_DIR,
  ])
})

test('parseStatus reads the status fixture', () => {
  const report = parseStatus(fixture('status-fresh.json'))
  assert.equal(report.current, false)
  assert.equal(report.next, 'bmad setup')
  assert.equal(report.modules.length, 2)
  assert.deepEqual(report.modules[0].skills, ['bmad'])
  assert.equal(report.modules[1].module, 'method')
  assert.equal(report.modules[1].absent_skills.length, 22)
})

test('parseStatus sees the moved skill in the after-prd fixture', () => {
  const report = parseStatus(fixture('status-after-prd.json'))
  assert.deepEqual(report.modules[1].skills, ['bmad-prd'])
  assert.equal(report.modules[1].absent_skills.includes('bmad-prd'), false)
  assert.equal(report.modules[1].absent_skills.length, 21)
})

test('parseStatus throws BmadScriptsError on unparsable stdout', () => {
  assert.throws(() => parseStatus('not json'), BmadScriptsError)
  assert.throws(() => parseStatus('[]'), BmadScriptsError)
})

test('parseMigrations returns the migrations entries', () => {
  const migrations = parseMigrations(fixture('knowledge-migrations.json'))
  assert.equal(migrations.length, 1)
  assert.equal(migrations[0].module, 'method')
  assert.equal(migrations[0].from, '6')
  assert.equal(migrations[0].to, '7')
})

test('parseMigrations returns [] when the key is missing', () => {
  assert.deepEqual(parseMigrations(fixture('knowledge-no-migrations.json')), [])
})

test('status runs setup.py and parses the report', async () => {
  const { runner, calls } = fakeRunner([{ stdout: fixture('status-fresh.json') }])
  const scripts = createBmadScripts({ runner })
  const report = await scripts.status(BMAD_DIR, PROJECT)
  assert.equal(report.mode, 'status')
  assert.deepEqual(calls[0].argv, setupStatusArgv(BMAD_DIR, PROJECT))
})

test('status throws with the stderr on a non-zero exit', async () => {
  const { runner } = fakeRunner([{ code: 1, stderr: 'error: boom' }])
  const scripts = createBmadScripts({ runner })
  await assert.rejects(
    () => scripts.status(BMAD_DIR, PROJECT),
    (err) => {
      assert.ok(err instanceof BmadScriptsError)
      assert.equal(err.stderr, 'error: boom')
      return true
    },
  )
})

test('status throws with the stderr on unparsable stdout', async () => {
  const { runner } = fakeRunner([{ code: 0, stdout: 'huh', stderr: 'warning' }])
  const scripts = createBmadScripts({ runner })
  await assert.rejects(
    () => scripts.status(BMAD_DIR, PROJECT),
    (err) => {
      assert.ok(err instanceof BmadScriptsError)
      assert.equal(err.stderr, 'warning')
      return true
    },
  )
})

test('status reports a spawn error in the stderr it carries', async () => {
  const { runner } = fakeRunner([{ code: null, error: 'spawn uv ENOENT' }])
  const scripts = createBmadScripts({ runner })
  await assert.rejects(
    () => scripts.status(BMAD_DIR, PROJECT),
    (err) => {
      assert.ok(err instanceof BmadScriptsError)
      assert.match(err.stderr, /ENOENT/)
      return true
    },
  )
})

test('migrations runs knowledge.py and returns the entries', async () => {
  const { runner, calls } = fakeRunner([{ stdout: fixture('knowledge-migrations.json') }])
  const scripts = createBmadScripts({ runner })
  const migrations = await scripts.migrations(BMAD_DIR)
  assert.equal(migrations.length, 1)
  assert.deepEqual(calls[0].argv, knowledgeArgv(BMAD_DIR))
})

test('migrations returns [] on a failed run or unparsable output', async () => {
  const failed = createBmadScripts({ runner: fakeRunner([{ code: 1, stderr: 'boom' }]).runner })
  assert.deepEqual(await failed.migrations(BMAD_DIR), [])

  const garbage = createBmadScripts({ runner: fakeRunner([{ code: 0, stdout: 'nope' }]).runner })
  assert.deepEqual(await garbage.migrations(BMAD_DIR), [])

  const missing = createBmadScripts({
    runner: fakeRunner([{ stdout: fixture('knowledge-no-migrations.json') }]).runner,
  })
  assert.deepEqual(await missing.migrations(BMAD_DIR), [])
})
