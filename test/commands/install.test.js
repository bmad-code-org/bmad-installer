import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { install } from '../../src/commands/install.js'
import {
  RECORDS,
  fakeBmadScripts,
  fakePrompts,
  fakeRunner,
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
  assert.deepEqual(only(requests).map((request) => request.source), [
    'bmad-code-org/BMAD-METHOD/skills/core-tools',
    'bmad-code-org/BMAD-METHOD/skills/method',
    'bmad-code-org/BMAD-METHOD/skills/toolsmith',
  ])
  for (const request of only(requests)) {
    assert.deepEqual(request.skills, ['*'])
    assert.deepEqual(request.agents, ['universal'])
  }
})

test('a skipped skill is reported and turns the run into an exit 1', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({
    lists: [[], RECORDS.map(listed)],
    add: (request) => request.source.endsWith('/method')
      ? [{ name: 'bmad-build', status: 'installed' }, { name: 'bmad-agent-pm', status: 'skipped', reason: 'No matching skill found in source' }]
      : [{ name: 'bmad', status: 'installed' }],
  })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir, yes: true }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 1)
  assert.ok(said.warns.some((warning) => warning.includes('Failed to install bmad-agent-pm: No matching skill found in source')))
  assert.ok(said.notes.at(-1)?.startsWith(messages.summaryTitleProblems))
})

test('the run stops when bmad did not land in the project', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], []] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf()] })

  const code = await install(
    options({ directory: dir, yes: true }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 1)
  assert.deepEqual(said.fails, [messages.firstInstallNotInProject.replace('{directory}', dir)])
  assert.equal(only(requests).length, 3)
})

test('a record call that failed is explained', async (t) => {
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
})

test('a failure on a Node below the skills CLI floor says so, a clean run never does', async (t) => {
  const dir = await tempDir(t)
  const hint = messages.nodeBelowSkillsFloor.replace('{version}', '22.13.0')
  const failing = fakePrompts()
  const { cli } = fakeSkillsCli({ lists: [[], []], add: () => [{ status: 'failed', error: 'Failed to clone repository' }] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf()] })
  await install(options({ directory: dir, yes: true }), { ...makeDeps({ prompts: failing.prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }), node: '22.13.0' })
  assert.ok(failing.said.fails[0].endsWith(hint), failing.said.fails[0])

  const clean = fakePrompts()
  const ok = fakeSkillsCli({ lists: [[], RECORDS.map(listed)] })
  const okScripts = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })
  await install(options({ directory: dir, yes: true }), { ...makeDeps({ prompts: clean.prompts, skillsCli: ok.cli, bmadScripts: okScripts.scripts, cwd: dir }), node: '22.13.0' })
  assert.equal([...clean.said.warns, ...clean.said.fails].some((text) => text.includes('22.13.0')), false)
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
  const { runner, calls } = fakeRunner()

  const code = await install(
    options({ directory: dir }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, runner }),
  )

  assert.equal(code, 0)
  assert.equal(calls.filter((argv) => argv.join(' ') === 'uv --version').length, 1, 'preflight ran twice')
  assert.ok(asked.includes('existing'))
  assert.equal(asked.includes('modules'), false)
  assert.deepEqual(only(requests).map((request) => request.source), [
    'bmad-code-org/BMAD-METHOD/skills/core-tools',
    'bmad-code-org/BMAD-METHOD/skills/method',
  ])
  assert.ok(said.notes.at(-1)?.startsWith(messages.summaryTitleUpdated))
})

test('unticking an installed module keeps it and says so', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts({ modules: ['founder'] })
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad'), listed('bmod-core-tools'), listed('bmod-method')], RECORDS.map(listed)] })
  const installed = statusOf()
  installed.modules.forEach((entry) => { entry.absent_skills = [] })
  const { scripts } = fakeBmadScripts({ statuses: [installed, installed, installed] })

  await install(options({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }))

  assert.ok(said.warns.includes(messages.modulesKept.replace('{modules}', 'BMad Method')), said.warns.join('\n'))
  assert.deepEqual(only(requests).map((request) => request.source), ['bmad-code-org/BMAD-METHOD/skills/founder'])
})

test('--modules with a folder installs that module whole next to the listed ones', async (t) => {
  const dir = await tempDir(t)
  const { prompts } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[], RECORDS.map(listed)] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await install(
    options({ directory: dir, yes: true, modules: 'method,acme/mods/skills/widgets' }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }),
  )

  assert.equal(code, 0)
  assert.deepEqual(only(requests).map((request) => [request.source, request.skills]), [
    ['bmad-code-org/BMAD-METHOD/skills/core-tools', ['*']],
    ['bmad-code-org/BMAD-METHOD/skills/method', ['*']],
    ['acme/mods/skills/widgets', ['*']],
  ])
})
