import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastPickedAgents, saveAgentPick, savedAgentPick, savedPickPath, skillsLockPath } from '../src/agent-picks.js'

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
  const dir = await mkdtemp(join(tmpdir(), 'bmad-picks-'))
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

test('savedPickPath is in ~/.bmad', () => {
  assert.equal(savedPickPath({ HOME: '/home/env' }, '/home/user'), join('/home/env', '.bmad', 'last-agents.json'))
  assert.equal(savedPickPath({}, '/home/user'), join('/home/user', '.bmad', 'last-agents.json'))
})

test('saveAgentPick and savedAgentPick round-trip, null before the first pick', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-picks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env = { HOME: dir }

  assert.equal(await savedAgentPick(env), null)
  await saveAgentPick(['claude-code', 'codex'], env)
  assert.deepEqual(await savedAgentPick(env), ['claude-code', 'codex'])
  await writeFile(savedPickPath(env), 'not json')
  assert.equal(await savedAgentPick(env), null)
})

test('saveAgentPick leaves no temporary file behind', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-picks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const env = { HOME: dir }
  await saveAgentPick(['codex'], env)
  await saveAgentPick(['claude-code'], env)
  assert.deepEqual(await savedAgentPick(env), ['claude-code'])
  assert.deepEqual(await readdir(join(dir, '.bmad')), ['last-agents.json'])
})
