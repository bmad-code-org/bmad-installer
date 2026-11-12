import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AgentsError } from '../../src/agents.js'
import { install } from '../../src/commands/install.js'
import { skillsLockPath } from '../../src/harness.js'
import {
  HOME,
  RECORDS,
  detectWith,
  fakeBmadScripts,
  fakePrompts,
  fakeSkillsCli,
  listed,
  makeDeps,
  only,
  options,
  statusOf,
  tempDir,
} from '../helpers/command-fakes.js'

/** @param {string} dir */
function parts(dir) {
  const { cli, requests } = fakeSkillsCli({ lists: [[], RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })
  return { cli, requests, scripts, env: { XDG_STATE_HOME: join(dir, 'state') } }
}

/** @param {string} dir @param {string[]} agents */
async function writeLastPick(dir, agents) {
  const lockPath = skillsLockPath({ XDG_STATE_HOME: join(dir, 'state') })
  await mkdir(dirname(lockPath), { recursive: true })
  await writeFile(lockPath, JSON.stringify({ version: 3, lastSelectedAgents: agents }))
}

test('--yes with no agent found installs to the universal folder only', async (t) => {
  const dir = await tempDir(t)
  const { prompts, asked } = fakePrompts()
  const { cli, requests, scripts, env } = parts(dir)

  const code = await install(options({ directory: dir, yes: true }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env }))

  assert.equal(code, 0)
  assert.deepEqual(asked, ['intro'])
  assert.equal(only(requests).length, 3)
  for (const request of only(requests)) assert.deepEqual(request.agents, ['universal'])
})

test('--yes takes the agents found on this machine, with the shared-folder ones as one', async (t) => {
  const dir = await tempDir(t)
  const { prompts } = fakePrompts()
  const { cli, requests, scripts, env } = parts(dir)
  const detect = detectWith([join(HOME, '.claude'), join(HOME, '.codex'), join(HOME, '.cursor')])

  await install(options({ directory: dir, yes: true }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect }))

  for (const request of only(requests)) assert.deepEqual(request.agents, ['universal', 'claude-code'])
})

test('--tools wins, keeps the ids given, takes display names in any case and skips the picker', async (t) => {
  const dir = await tempDir(t)
  const { prompts, asked } = fakePrompts()
  const { cli, requests, scripts, env } = parts(dir)

  const code = await install(
    options({ directory: dir, tools: 'claude-code, CURSOR,Claude Code' }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect: detectWith([join(HOME, '.codex')]) }),
  )

  assert.equal(code, 0)
  assert.equal(asked.includes('agents'), false)
  for (const request of only(requests)) assert.deepEqual(request.agents, ['claude-code', 'cursor'])
})

test('an unknown --tools id stops the run before anything installs', async (t) => {
  const dir = await tempDir(t)
  const { prompts } = fakePrompts()
  const { cli, requests, scripts, env } = parts(dir)

  await assert.rejects(
    install(options({ directory: dir, yes: true, tools: 'claude-code,nope' }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env })),
    (error) => error instanceof AgentsError && error.message === 'nope',
  )
  assert.equal(only(requests).length, 0)
})

test('the picker runs after the module prompt and its answer goes to every call', async (t) => {
  const dir = await tempDir(t)
  const { prompts, asked, said, pickers } = fakePrompts({ agents: ['codex', 'claude-code'] })
  const { cli, requests, scripts, env } = parts(dir)

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect: detectWith([join(HOME, '.codex')]) }),
  )

  assert.equal(code, 0)
  assert.deepEqual(asked, ['intro', 'confirm', 'modules', 'agents'])
  assert.deepEqual(pickers[0], { initial: [], found: ['codex'] }, 'a found agent is listed, not ticked')
  for (const request of only(requests)) assert.deepEqual(request.agents, ['codex', 'claude-code'])
  assert.ok(said.plain.some((text) => text.includes('npx bmad-method install -m method -t codex,claude-code -y')))
  assert.ok(said.notes.at(-1)?.includes('Agents    Codex, Claude Code'))
})

test('on a fresh project the picker ticks the last skills CLI pick', async (t) => {
  const dir = await tempDir(t)
  await writeLastPick(dir, ['augment', 'cursor', 'not-an-agent'])
  const { prompts, pickers } = fakePrompts()
  const { cli, scripts, env } = parts(dir)

  await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect: detectWith([join(HOME, '.codex')]) }),
  )

  assert.deepEqual(pickers[0].initial, ['augment', 'cursor'])
})

test('the picker prefers the agents already holding bmad in the project', async (t) => {
  const dir = await tempDir(t)
  await writeLastPick(dir, ['cursor'])
  const { prompts, pickers } = fakePrompts()
  const { cli, scripts, env } = parts(dir)
  const detect = detectWith([
    join(HOME, '.codex'),
    join(dir, '.claude', 'skills', 'bmad'),
    join(dir, '.agents', 'skills', 'bmad'),
  ])

  await install(options({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect }))

  assert.deepEqual(pickers[0].initial, ['claude-code', 'codex'], 'cursor was the last pick but is not found, so the shared folder ticks only codex')
})
