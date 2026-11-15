import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { update } from '../../src/commands/update.js'
import {
  HOME,
  detectWith,
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
  assert.equal(only(requests).length, 0)
})

test('the update re-adds each installed module whole to the agents holding bmad, then reports and closes', async (t) => {
  const dir = await tempDir(t)
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad'), listed('bmod-method')]] })
  const { scripts, seen } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })
  const detect = detectWith([join(HOME, '.grok'), join(dir, '.claude', 'skills', 'bmad'), join(dir, '.agents', 'skills', 'bmad')])

  const code = await update(updateOptions({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, detect }))

  assert.equal(code, 0)
  assert.deepEqual(only(requests).map((request) => [request.source, request.skills, request.agents]), [
    ['bmad-code-org/BMAD-METHOD/skills/core-tools', ['*'], ['universal', 'claude-code']],
    ['bmad-code-org/BMAD-METHOD/skills/method', ['*'], ['universal', 'claude-code']],
  ])
  assert.deepEqual(seen, ['/project/.agents/skills/bmad', '/project/.agents/skills/bmad'])
  const summary = said.notes.at(-1) ?? ''
  assert.ok(summary.startsWith(messages.summaryTitleUpdated), summary)
  assert.ok(summary.includes('bmad setup'))
  assert.equal(summary.includes('Agents'), false, 'update shows no agents line')
  assert.equal(said.plain.some((text) => text.includes('npx bmad-method update')), false)
  assert.ok(said.plain.at(-1)?.startsWith('Thanks for installing BMad.'))
  assert.deepEqual(said.finish, [''])
})

test('a single-agent install updates into that agent only', async (t) => {
  const dir = await tempDir(t)
  const { prompts } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad')]] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  await update(updateOptions({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir, detect: detectWith([join(dir, '.augment', 'skills', 'bmad')]) }))

  for (const request of only(requests)) assert.deepEqual(request.agents, ['augment'])
})

test('a failed module is reported and exits 1', async () => {
  const { prompts, said } = fakePrompts()
  const { cli } = fakeSkillsCli({ lists: [[listed('bmad')]], add: () => [{ status: 'failed', error: 'Failed to clone repository' }] })
  const { scripts } = fakeBmadScripts({ statuses: [statusOf(), statusOf()] })

  const code = await update(updateOptions(), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts }))

  assert.equal(code, 1)
  assert.ok(said.warns.some((warning) => warning.includes('Failed to clone repository')))
  assert.ok(said.notes.some((note) => note.startsWith(messages.summaryTitleUpdatedProblems)))
})

test('a module not on the list is re-added from the source its record came from, its own skills named', async (t) => {
  const dir = await tempDir(t)
  const report = statusOf()
  report.modules.push({ ...report.modules[1], module: 'widgets', folder: 'bmod-widgets', skills: ['acme-widget'], absent_skills: ['acme-gadget'] })
  report.modules.push({ ...report.modules[1], module: 'loose', folder: 'bmod-loose', skills: [], absent_skills: [] })
  await writeFile(join(dir, 'skills-lock.json'), JSON.stringify({
    version: 1,
    skills: { 'bmod-widgets': { source: 'acme/mods', sourceType: 'github', ref: 'dev', skillPath: 'skills/widgets/bmod-widgets/SKILL.md' } },
  }))
  const { prompts, said } = fakePrompts()
  const { cli, requests } = fakeSkillsCli({ lists: [[listed('bmad')]] })
  const { scripts } = fakeBmadScripts({ statuses: [report, report] })

  await update(updateOptions({ directory: dir }), makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, cwd: dir }))

  assert.deepEqual(only(requests).at(-1)?.source, 'acme/mods/skills/widgets#dev')
  assert.deepEqual(only(requests).at(-1)?.skills, ['bmod-widgets', 'acme-widget', 'acme-gadget'])
  assert.equal(only(requests).length, 3)
  assert.ok(said.says.includes(messages.updateNotListed.replace('{modules}', 'loose')))
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
