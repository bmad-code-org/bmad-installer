import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distTag, newerVersion } from '../src/self-update.js'

/** @typedef {import('../src/run.js').RunRequest} RunRequest */
/** @typedef {import('../src/run.js').RunResult} RunResult */
/** @typedef {import('../src/run.js').Runner} Runner */

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

test('distTag picks next for a prerelease and latest otherwise', () => {
  assert.equal(distTag('6.13.0-next.0'), 'next')
  assert.equal(distTag('6.13.0-beta'), 'next')
  assert.equal(distTag('6.13.0'), 'latest')
  assert.equal(distTag('6.12.10'), 'latest')
})

test('newerVersion asks npm for the dist tag with a timeout', async () => {
  /** @type {RunRequest[]} */
  const calls = []
  const runner = fakeRunner({ stdout: '6.13.0\n' }, calls)
  assert.equal(await newerVersion({ runner, version: '6.12.0', timeoutMs: 5000 }), '6.13.0')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].argv, ['npm', 'view', 'bmad-method@latest', 'version'])
  assert.equal(calls[0].timeoutMs, 5000)
})

test('newerVersion uses the next tag for a prerelease', async () => {
  /** @type {RunRequest[]} */
  const calls = []
  const runner = fakeRunner({ stdout: '6.13.0-next.1\n' }, calls)
  assert.equal(await newerVersion({ runner, version: '6.13.0-next.0' }), '6.13.0-next.1')
  assert.deepEqual(calls[0].argv, ['npm', 'view', 'bmad-method@next', 'version'])
})

test('newerVersion returns null for the same or an older version', async () => {
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '6.13.0\n' }), version: '6.13.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '6.11.9\n' }), version: '6.12.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '6.12.0\n' }), version: '6.12.1' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '5.9.9\n' }), version: '6.0.0' }), null)
})

test('newerVersion orders prereleases below their release', async () => {
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '6.13.0\n' }), version: '6.13.0-next.0' }), '6.13.0')
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '6.13.0-next.9\n' }), version: '6.13.0' }), null)
  assert.equal(
    await newerVersion({ runner: fakeRunner({ stdout: '6.13.0-next.10\n' }), version: '6.13.0-next.9' }),
    '6.13.0-next.10',
  )
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '6.13.0-next.1\n' }), version: '6.13.0-next.1' }), null)
})

test('newerVersion returns null on timeout, failure or garbage', async () => {
  assert.equal(await newerVersion({ runner: fakeRunner({ code: null, timedOut: true }), version: '6.12.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ code: 1, stderr: 'E404' }), version: '6.12.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: 'npm ERR! code E404\n' }), version: '6.12.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '' }), version: '6.12.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '7\n' }), version: '6.12.0' }), null)
  assert.equal(await newerVersion({ runner: fakeRunner({ stdout: '7.0.0\n' }), version: 'not-a-version' }), null)
})

test('newerVersion never throws when the runner rejects', async () => {
  /** @type {Runner} */
  const runner = async () => {
    throw new Error('spawn failed')
  }
  assert.equal(await newerVersion({ runner, version: '6.12.0' }), null)
})
