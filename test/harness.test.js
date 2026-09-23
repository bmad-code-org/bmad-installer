import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickedAgents, skillsLockPath, snapshotLock } from '../src/harness.js'

const OLD = new Date(1_000_000)
const NEW = new Date(2_000_000)

/** @returns {Promise<{ dir: string, lockPath: string }>} */
async function tempLock() {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-harness-'))
  return { dir, lockPath: join(dir, '.skill-lock.json') }
}

/**
 * @param {string} lockPath
 * @param {unknown} contents
 * @param {Date} mtime
 */
async function writeLock(lockPath, contents, mtime) {
  await writeFile(lockPath, typeof contents === 'string' ? contents : JSON.stringify(contents))
  await utimes(lockPath, mtime, mtime)
}

test('skillsLockPath honours XDG_STATE_HOME', () => {
  assert.equal(
    skillsLockPath({ XDG_STATE_HOME: '/state' }, '/home/user'),
    join('/state', 'skills', '.skill-lock.json'),
  )
})

test('skillsLockPath falls back to the home dir without XDG_STATE_HOME', () => {
  assert.equal(skillsLockPath({}, '/home/user'), join('/home/user', '.agents', '.skill-lock.json'))
  assert.equal(
    skillsLockPath({ XDG_STATE_HOME: '' }, '/home/user'),
    join('/home/user', '.agents', '.skill-lock.json'),
  )
})

test('snapshotLock reports a missing file and an existing one', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    assert.deepEqual(await snapshotLock(lockPath), { exists: false, mtimeMs: null })

    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['codex'] }, OLD)
    assert.deepEqual(await snapshotLock(lockPath), { exists: true, mtimeMs: OLD.getTime() })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns ids when the picker created the lock', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    const before = await snapshotLock(lockPath)
    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['claude-code', 'codex'] }, NEW)
    assert.deepEqual(await pickedAgents(lockPath, before), ['claude-code', 'codex'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns ids when the selection changed', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['opencode'] }, OLD)
    const before = await snapshotLock(lockPath)
    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['opencode', 'cursor'] }, NEW)
    assert.deepEqual(await pickedAgents(lockPath, before), ['opencode', 'cursor'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns ids when the user picked the same agents as last time', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['cursor'] }, OLD)
    const before = await snapshotLock(lockPath)
    await writeLock(
      lockPath,
      { version: 3, lastSelectedAgents: ['cursor'], dismissed: { findSkillsPrompt: true } },
      NEW,
    )
    assert.deepEqual(await pickedAgents(lockPath, before), ['cursor'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns null when the lock was untouched', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['claude-code'] }, OLD)
    const before = await snapshotLock(lockPath)
    assert.equal(await pickedAgents(lockPath, before), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns null when the lock still does not exist', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    const before = await snapshotLock(lockPath)
    assert.equal(await pickedAgents(lockPath, before), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns null for an empty, missing or non-string selection', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    const before = await snapshotLock(lockPath)

    await writeLock(lockPath, { version: 3, lastSelectedAgents: [] }, NEW)
    assert.equal(await pickedAgents(lockPath, before), null)

    await writeLock(lockPath, { version: 3, skills: {} }, NEW)
    assert.equal(await pickedAgents(lockPath, before), null)

    await writeLock(lockPath, { version: 3, lastSelectedAgents: ['claude-code', 7] }, NEW)
    assert.equal(await pickedAgents(lockPath, before), null)

    await writeLock(lockPath, { version: 3, lastSelectedAgents: 'claude-code' }, NEW)
    assert.equal(await pickedAgents(lockPath, before), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pickedAgents returns null when the lock is not JSON', async () => {
  const { dir, lockPath } = await tempLock()
  try {
    const before = await snapshotLock(lockPath)
    await writeLock(lockPath, 'not json', NEW)
    assert.equal(await pickedAgents(lockPath, before), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
