import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastPickedAgents, skillsLockPath } from '../src/harness.js'

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
