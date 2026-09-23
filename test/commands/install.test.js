import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { install } from '../../src/commands/install.js'
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

/** @typedef {import('../../src/bmad-scripts.js').Migration} Migration */

test('--yes takes the default modules and asks nothing', async (t) => {
  const dir = await tempDir(t)
  const { prompts, asked } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir, yes: true }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 0)
  assert.deepEqual(asked, ['intro'])
  const members = only(requests)[1]
  assert.equal(members.agents, null)
  for (const skill of ['bmad-prd', 'bmad-build', 'bmad-agent-dev', 'bmad-brainstorming']) {
    assert.ok(members.skills.includes(skill), `missing ${skill}`)
  }
  assert.equal(members.skills.includes('bmad-walkthrough'), false)
})

test('a skipped skill is reported and turns the run into an exit 1', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({
    lists: [[], RECORDS.map(listed)],
    add: (request) => request.skills.map((/** @type {string} */ name) => (
      name === 'bmad-prd'
        ? { name, status: 'skipped', reason: 'No matching skill found in source' }
        : { name, status: 'installed' }
    )),
  })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir, yes: true }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 1)
  assert.ok(said.notes.some((note) => note.includes('Failed to install bmad-prd: No matching skill found in source')))
})

test('the run stops when the first interactive install landed somewhere else', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], []] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf()] })

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, env: { XDG_STATE_HOME: join(dir, 'state') } }),
  )

  assert.equal(code, 1)
  assert.deepEqual(said.fails, [messages.firstInstallNotInProject.replace('{directory}', dir)])
  assert.equal(only(requests).length, 0)
})

test('a record call that failed is explained instead of blamed on the scope', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({
    lists: [[], []],
    add: () => [{ status: 'failed', error: 'Failed to clone repository' }],
  })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf()] })

  const code = await install(
    options({ directory: dir, yes: true }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 1)
  assert.equal(said.fails.length, 1)
  assert.ok(said.fails[0].includes('Failed to clone repository'))
  assert.equal(said.fails[0].includes('Project scope'), false)
})

test('a bundle skill the record no longer lists is named and skipped', async (t) => {
  const dir = await tempDir(t)
  const thinned = statusOf()
  thinned.modules[1].absent_skills = thinned.modules[1].absent_skills.filter((name) => name !== 'bmad-prd')
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({ statuses: [thinned, thinned] })

  const code = await install(
    options({ directory: dir, tools: 'claude-code' }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 0)
  assert.ok(said.warns.some((warning) => warning === 'Skipped skills that BMad Method no longer lists: bmad-prd'))
  assert.equal(only(requests)[1].skills.includes('bmad-prd'), false)
})

test('migrations are listed only for the major jump this run made', async (t) => {
  const dir = await tempDir(t)
  const before = statusOf()
  const after = statusOf()
  after.modules[1].version = '7.0.0'
  /** @param {Partial<Migration>} patch @returns {Migration} */
  const migration = (patch) => ({
    module: 'method', path: 'm.toml', file: '/p/m.toml', from: '6', to: '7', title: 'Move v6 artifacts', ...patch,
  })
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({ lists: [[listed('bmad'), listed('bmod-method')], RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({
    statuses: [before, after, after],
    migrations: [
      migration({}),
      migration({ from: '5', to: '6', title: 'Older jump' }),
      migration({ module: 'cis', title: 'Not chosen' }),
    ],
  })

  const code = await install(
    options({ directory: dir, tools: 'claude-code' }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 0)
  const listedMigrations = said.notes.find((note) => note.startsWith(messages.migrationsAvailable))
  assert.ok(listedMigrations)
  assert.deepEqual(listedMigrations.split('\n'), [
    messages.migrationsAvailable,
    'Move v6 artifacts (method, 6 to 7)',
  ])
  assert.ok(said.says.some((line) => line.startsWith(messages.foundModules)))
})

test('choosing quick update on an existing install runs the update flow', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said, asked } = fakePrompts({ existing: 'update' })
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad'), listed('bmod-method')]] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 0)
  assert.ok(asked.includes('existing'))
  assert.equal(asked.includes('modules'), false)
  assert.equal(only(requests, 'update').length, 1)
  assert.deepEqual(said.says.at(-1), messages.updateSpinnerDone)
})
