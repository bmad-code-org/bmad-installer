import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { install } from '../../src/commands/install.js'
import { skillsLockPath } from '../../src/harness.js'
import {
  RECORDS,
  fakeBmadScripts,
  fakePrompts,
  fakeSkillsCli,
  listed,
  makeDeps,
  messages,
  only,
  options,
  statusOf,
  tempDir,
} from '../helpers/command-fakes.js'

test('a fresh interactive run picks agents through the CLI and reuses them', async (t) => {
  const dir = await tempDir(t)
  const state = join(dir, 'state')
  const lockPath = skillsLockPath({ XDG_STATE_HOME: state })
  const { prompts, said, asked } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({
    lists: [[], RECORDS.map(listed), RECORDS.map(listed)],
    async onInteractive() {
      await mkdir(dirname(lockPath), { recursive: true })
      await writeFile(lockPath, JSON.stringify({ version: 3, lastSelectedAgents: ['claude-code', 'codex'] }))
    },
  })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env: { XDG_STATE_HOME: state } }),
  )

  assert.equal(code, 0)
  const [first] = only(requests, 'interactive')
  assert.deepEqual(first.skills, RECORDS)
  assert.equal(first.agents, undefined)
  assert.ok(said.notes.some((note) => note === messages.beforeSkillsPicker))

  const members = only(requests)
  assert.equal(members.length, 1)
  assert.deepEqual(members[0].agents, ['claude-code', 'codex'])
  assert.equal(members[0].source, 'bmad-code-org/BMAD-METHOD')
  assert.ok(members[0].skills.includes('bmad-prd'))
  assert.ok(members[0].skills.includes('bmad-brainstorming'))
  assert.equal(members[0].skills.includes('bmad-build'), false)

  assert.deepEqual(asked, ['intro', 'confirm', 'modules', 'bundles'])
  assert.ok(said.notes.at(-1)?.includes('bmad setup'))
  assert.ok(said.notes.some((note) => note.includes('ask the `bmad` skill what to do next')))
  assert.deepEqual(said.finish, [''])
})

test('an interactive run whose picker never ran sends no agent ids', async (t) => {
  const dir = await tempDir(t)
  const { prompts } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], RECORDS.map(listed), RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env: { XDG_STATE_HOME: join(dir, 'state') } }),
  )

  assert.equal(code, 0)
  assert.equal(only(requests)[0].agents, null)
})

test('a pick that matches the previous selection still carries the ids', async (t) => {
  const dir = await tempDir(t)
  const state = join(dir, 'state')
  const lockPath = skillsLockPath({ XDG_STATE_HOME: state })
  await mkdir(dirname(lockPath), { recursive: true })
  await writeFile(lockPath, JSON.stringify({ version: 3, lastSelectedAgents: ['cursor'] }))
  const { prompts } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({
    lists: [[], RECORDS.map(listed), RECORDS.map(listed)],
    async onInteractive() {
      await writeFile(lockPath, JSON.stringify({
        version: 3,
        lastSelectedAgents: ['cursor'],
        dismissed: { findSkillsPrompt: true },
      }))
    },
  })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env: { XDG_STATE_HOME: state } }),
  )

  assert.equal(code, 0)
  assert.deepEqual(only(requests)[0].agents, ['cursor'])
})

test('on a re-run the interactive call is the first add that is still needed', async (t) => {
  const dir = await tempDir(t)
  const state = join(dir, 'state')
  const lockPath = skillsLockPath({ XDG_STATE_HOME: state })
  const installed = [...RECORDS, 'bmad-prd', 'bmad-product-brief', 'bmad-prfaq', 'bmad-ux', 'bmad-architecture', 'bmad-spec', 'bmad-project-context']
  const withPlanning = statusOf()
  withPlanning.modules[1].skills = installed.slice(3)
  withPlanning.modules[1].absent_skills = withPlanning.modules[1].absent_skills.filter((name) => !installed.includes(name))
  const { prompts } = fakePrompts({ modules: ['method'], bundles: ['planning', 'build'] })
  const afterBuild = [...installed, ...withPlanning.modules.flatMap((entry) => entry.absent_skills)]
  const { cli, requests } = fakeSkillsCli({
    lists: [installed.map(listed), afterBuild.map(listed)],
    async onInteractive() {
      await mkdir(dirname(lockPath), { recursive: true })
      await writeFile(lockPath, JSON.stringify({ version: 3, lastSelectedAgents: ['claude-code'] }))
    },
  })
  const { scripts } = fakeBmadScripts({ statuses: [withPlanning, withPlanning, withPlanning] })

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env: { XDG_STATE_HOME: state } }),
  )

  assert.equal(code, 0)
  assert.equal(only(requests).length, 0)
  const [first] = only(requests, 'interactive')
  assert.ok(first.skills.includes('bmad-build'))
  for (const name of installed) assert.equal(first.skills.includes(name), false, `${name} was re-added`)
})

test('--tools makes every call headless and carries the ids', async (t) => {
  const dir = await tempDir(t)
  const { prompts, asked } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir, tools: 'claude-code, codex' }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 0)
  assert.equal(only(requests, 'interactive').length, 0)
  for (const request of only(requests)) assert.deepEqual(request.agents, ['claude-code', 'codex'])
  assert.deepEqual(only(requests)[0].skills, RECORDS)
  assert.ok(asked.includes('modules'))
})

