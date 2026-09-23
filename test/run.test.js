import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunner } from '../src/run.js'

test('captures stdout, stderr and exit code', async () => {
  const run = createRunner()
  const result = await run({
    argv: [process.execPath, '-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
  })
  assert.equal(result.code, 3)
  assert.equal(result.stdout, 'out')
  assert.equal(result.stderr, 'err')
  assert.equal(result.timedOut, false)
  assert.equal(result.error, undefined)
})

test('captures output far past the stdout pipe buffer when the child calls process.exit', async () => {
  const run = createRunner()
  const result = await run({
    argv: [process.execPath, '-e', "process.stdout.write('x'.repeat(200000)); process.exit(0)"],
  })
  assert.equal(result.code, 0)
  assert.equal(result.stdout.length, 200000)
})

test('decodes multi-byte output across chunk boundaries', async () => {
  const run = createRunner()
  const script = "const s = 'café–'.repeat(20000); process.stdout.write(s); process.stderr.write(s)"
  const result = await run({ argv: [process.execPath, '-e', script] })
  assert.equal(result.stdout.length, 100000)
  assert.equal(result.stderr.length, 100000)
  assert.equal(result.stdout.includes('�'), false)
  assert.equal(result.stderr.includes('�'), false)
})

test('kills the child and reports timedOut on timeout', async () => {
  const run = createRunner()
  const result = await run({
    argv: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'],
    timeoutMs: 200,
  })
  assert.equal(result.timedOut, true)
  assert.notEqual(result.code, 0)
})

test('resolves with code null and an error for a missing executable', async () => {
  const run = createRunner()
  const result = await run({ argv: ['bmad-installer-does-not-exist-xyz'] })
  assert.equal(result.code, null)
  assert.equal(result.timedOut, false)
  assert.ok(result.error)
})

test('inherit stdio returns empty stdout and stderr', async () => {
  const run = createRunner()
  const result = await run({
    argv: [process.execPath, '-e', "process.stdout.write('out'); process.exit(0)"],
    stdio: 'inherit',
  })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('debug option logs the command line and the exit', async () => {
  /** @type {string[]} */
  const lines = []
  const run = createRunner({ debug: true, log: (line) => lines.push(line) })
  await run({ argv: [process.execPath, '-e', "process.stdout.write('hi')"], cwd: process.cwd() })
  assert.ok(lines.some((line) => line.startsWith(`$ ${process.cwd()}:`)))
  assert.ok(lines.some((line) => line === 'exit 0'))
  assert.ok(lines.some((line) => line === 'hi'))
})
