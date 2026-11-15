import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastPickedAgents, saveLastPickedAgents, skillsLockPath } from '../src/harness.js'

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

test('lastPickedAgents reads the string ids of the last pick', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-harness-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env = { XDG_STATE_HOME: dir }
  const lockPath = skillsLockPath(env)

  assert.deepEqual(await lastPickedAgents(env), [])
  await mkdir(join(dir, 'skills'), { recursive: true })
  await writeFile(lockPath, JSON.stringify({ version: 3, lastSelectedAgents: ['cursor', 7, 'codex'] }))
  assert.deepEqual(await lastPickedAgents(env), ['cursor', 'codex'])
  await writeFile(lockPath, JSON.stringify({ version: 3 }))
  assert.deepEqual(await lastPickedAgents(env), [])
  await writeFile(lockPath, 'not json')
  assert.deepEqual(await lastPickedAgents(env), [])
})

test('saveLastPickedAgents keeps the rest of the lock and starts over from a lock the CLI would discard', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-harness-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env = { XDG_STATE_HOME: dir }
  const lockPath = skillsLockPath(env)

  await saveLastPickedAgents(['codex'], env)
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), { version: 3, skills: {}, dismissed: {}, lastSelectedAgents: ['codex'] })

  await writeFile(lockPath, JSON.stringify({ version: 3, skills: { bmad: { source: 'x' } }, lastSelectedAgents: ['cursor'] }))
  await saveLastPickedAgents(['claude-code', 'codex'], env)
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), { version: 3, skills: { bmad: { source: 'x' } }, lastSelectedAgents: ['claude-code', 'codex'] })

  await writeFile(lockPath, JSON.stringify({ version: 2, skills: { old: {} } }))
  await saveLastPickedAgents(['codex'], env)
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')).skills, {})
})
