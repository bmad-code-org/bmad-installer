import { test } from 'node:test'
import assert from 'node:assert/strict'
import { update } from '../../src/commands/update.js'
import {
  fakeBmadScripts,
  fakePrompts,
  fakeSkillsCli,
  listed,
  makeDeps,
  messages,
  only,
  options,
  statusOf,
} from '../helpers/command-fakes.js'

/** @param {Partial<import('../../src/cli.js').CliOptions>} [patch] */
function updateOptions(patch = {}) {
  return options({ command: 'update', yes: true, ...patch })
}

test('nothing to update without the bmad skill', async () => {
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad-prd')]] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf()] })

  const code = await update(updateOptions(), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts }))

  assert.equal(code, 1)
  assert.deepEqual(said.fails, [messages.nothingToUpdate])
  assert.equal(only(requests, 'update').length, 0)
})

test('the update runs the CLI, then reports and closes', async () => {
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad'), listed('bmod-method')]] })
  const { scripts, seen } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await update(
    updateOptions({ directory: '/project' }),
    makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts }),
  )

  assert.equal(code, 0)
  assert.deepEqual(only(requests, 'update'), [{ kind: 'update', cwd: '/project' }])
  assert.deepEqual(seen, ['/project/.agents/skills/bmad', '/project/.agents/skills/bmad'])
  assert.deepEqual(said.says, [messages.updateSpinnerDone])
  assert.ok(said.notes.some((note) => note.startsWith(messages.reportTitle)))
  assert.ok(said.notes.some((note) => note.includes('ask the `bmad` skill what to do next')))
  assert.ok(said.notes.at(-1)?.includes('bmad setup'))
  assert.deepEqual(said.finish, [''])
})

test('a failing skills CLI still reports and exits 1', async () => {
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({ lists: [[listed('bmad')]], updateCode: 1 })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await update(updateOptions(), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts }))

  assert.equal(code, 1)
  assert.ok(said.notes.some((note) => note.startsWith(messages.reportTitle)))
})

test('migrations compare the versions before and after the update', async () => {
  const before = statusOf()
  const after = statusOf()
  after.modules[1].version = '7.0.0'
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({ lists: [[listed('bmad'), listed('bmod-method')]] })
  const { scripts } = fakeBmadScripts({
    statuses: [before, after],
    migrations: [
      { module: 'method', path: 'm.toml', file: '/p/m.toml', from: '6', to: '7', title: 'Move v6 artifacts' },
      { module: 'core-tools', path: 'c.toml', file: '/p/c.toml', from: '6', to: '7', title: 'No jump here' },
    ],
  })

  const code = await update(updateOptions(), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts }))

  assert.equal(code, 0)
  const listedMigrations = said.notes.find((note) => note.startsWith(messages.migrationsAvailable))
  assert.deepEqual(listedMigrations?.split('\n'), [messages.migrationsAvailable, 'Move v6 artifacts (method, 6 to 7)'])
})
