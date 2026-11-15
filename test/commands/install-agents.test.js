import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AgentsError } from '../../src/agents.js'
import { install } from '../../src/commands/install.js'
import { savedAgentPick, saveAgentPick, skillsLockPath } from '../../src/harness.js'
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
  return { cli, requests, scripts, env: { HOME: dir, XDG_STATE_HOME: join(dir, 'state') } }
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

test('--yes with no pick takes the agents with a config folder, the shared-folder ones as one', async (t) => {
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
  assert.deepEqual(pickers[0], { initial: [] }, 'an agent with a config folder is not ticked')
  for (const request of only(requests)) assert.deepEqual(request.agents, ['codex', 'claude-code'])
  assert.ok(said.plain.some((text) => text.includes('npx bmad-method install -m method -t codex,claude-code -y')))
  assert.ok(said.notes.at(-1)?.includes('Agents    Codex, Claude Code'))
})

test('on a fresh project the picker ticks the skills CLI pick without its shared-folder agents', async (t) => {
  const dir = await tempDir(t)
  await writeLastPick(dir, ['amp', 'augment', 'cursor', 'claude-code', 'not-an-agent'])
  const { prompts, pickers } = fakePrompts()
  const { cli, scripts, env } = parts(dir)

  await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect: detectWith([join(HOME, '.codex')]) }),
  )

  assert.deepEqual(pickers[0].initial, ['augment', 'claude-code'], 'the skills CLI records every shared-folder agent as picked')
})

test('our own saved pick wins over the skills CLI pick, shared-folder agents included', async (t) => {
  const dir = await tempDir(t)
  await writeLastPick(dir, ['augment'])
  const { prompts, pickers } = fakePrompts()
  const { cli, scripts, env } = parts(dir)
  await saveAgentPick(['codex', 'cursor'], env)

  await install(options({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env }))

  assert.deepEqual(pickers[0].initial, ['codex', 'cursor'])
})

test('the picker ticks own-folder agents holding bmad and only the shared-folder agents of the last pick', async (t) => {
  const dir = await tempDir(t)
  const { prompts, pickers } = fakePrompts()
  const { cli, scripts, env } = parts(dir)
  await saveAgentPick(['cursor', 'codex', 'augment'], env)
  const detect = detectWith([
    join(HOME, '.codex'),
    join(HOME, '.gemini'),
    join(HOME, '.cursor'),
    join(dir, '.claude', 'skills', 'bmad'),
    join(dir, '.agents', 'skills', 'bmad'),
  ])

  await install(options({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect }))

  assert.deepEqual(pickers[0].initial, ['claude-code', 'cursor', 'codex'], 'augment has its own folder without bmad; gemini has a config folder but was never picked')
})

test('a shared folder holding bmad ticks nothing the user did not pick', async (t) => {
  const dir = await tempDir(t)
  const { prompts, pickers } = fakePrompts()
  const { cli, scripts, env } = parts(dir)
  const detect = detectWith([join(HOME, '.codex'), join(HOME, '.gemini'), join(dir, '.agents', 'skills', 'bmad')])

  await install(options({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect }))

  assert.deepEqual(pickers[0].initial, [])
})

test('the pick is saved as the last pick and ticked on the next run', async (t) => {
  const dir = await tempDir(t)
  const first = fakePrompts({ agents: ['codex', 'claude-code'] })
  const { cli, scripts, env } = parts(dir)

  await install(options({ directory: dir }), makeDeps({ prompts: first.prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env }))

  assert.deepEqual(await savedAgentPick(env), ['codex', 'claude-code'])

  const second = fakePrompts()
  const again = parts(dir)
  await install(options({ directory: dir }), makeDeps({ prompts: second.prompts, skillsCli: again.cli, bmadScripts: again.scripts, cwd: dir, env }))
  assert.deepEqual(second.pickers[0].initial, ['codex', 'claude-code'])
})

test('--yes takes what the picker would tick before any config folder', async (t) => {
  const dir = await tempDir(t)
  const { prompts } = fakePrompts()
  const { cli, requests, scripts, env } = parts(dir)
  await saveAgentPick(['codex'], env)
  const detect = detectWith([join(HOME, '.claude'), join(HOME, '.warp'), join(dir, '.claude', 'skills', 'bmad'), join(dir, '.agents', 'skills', 'bmad')])

  await install(options({ directory: dir, yes: true }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env, detect }))

  for (const request of only(requests)) assert.deepEqual(request.agents, ['claude-code', 'codex'])
})
