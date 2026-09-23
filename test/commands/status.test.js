import { test } from 'node:test'
import assert from 'node:assert/strict'
import { status } from '../../src/commands/status.js'
import { PreflightError } from '../../src/preflight.js'
import {
  fakeBmadScripts,
  fakePrompts,
  fakeRunner,
  fakeSkillsCli,
  listed,
  makeDeps,
  messages,
  options,
  statusOf,
} from '../helpers/command-fakes.js'

/** @typedef {import('../../src/bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../../src/skills-cli.js').ListedSkill} ListedSkill */

/** @param {{ uv?: boolean, lists: ListedSkill[][], report?: StatusReport }} script */
function statusDeps(script) {
  const { prompts, said } = fakePrompts()
  const { runner, calls } = fakeRunner({ uv: script.uv })
  const { cli } = fakeSkillsCli({ lists: script.lists })
  const { scripts } = fakeBmadScripts({ statuses: [script.report ?? statusOf()] })
  return { deps: makeDeps({ prompts, skillsCli: cli, bmadScripts: scripts, runner }), said, calls }
}

/** @param {Partial<import('../../src/cli.js').CliOptions>} [patch] */
function statusOptions(patch = {}) {
  return options({ command: 'status', yes: true, ...patch })
}

test('a missing uv stops the status before anything is read', async () => {
  const { deps } = statusDeps({ uv: false, lists: [[listed('bmad')]] })
  await assert.rejects(() => status(statusOptions(), deps), PreflightError)
})

test('nothing installed without the bmad skill', async () => {
  const { deps, said } = statusDeps({ lists: [[listed('bmad-prd')]] })

  assert.equal(await status(statusOptions(), deps), 1)
  assert.deepEqual(said.fails, [messages.nothingInstalled])
  assert.deepEqual(said.notes, [])
})

test('an unfinished install prints the report and exits 1', async () => {
  const { deps, said, calls } = statusDeps({ lists: [[listed('bmad'), listed('bmod-method')]] })

  assert.equal(await status(statusOptions(), deps), 1)
  assert.equal(said.notes.length, 1)
  const lines = said.notes[0].split('\n')
  assert.equal(lines[0], messages.reportTitle)
  assert.equal(lines[1], 'Not finished yet. Next: bmad setup')
  assert.ok(lines.some((line) => line.startsWith('BMad Method 6.13.0-next')))
  assert.deepEqual(calls, [['uv', '--version']])
  assert.deepEqual(said.finish, [])
})

test('a finished install exits 0', async () => {
  const report = statusOf({ current: true, next: null })
  const { deps, said } = statusDeps({ lists: [[listed('bmad')]], report })

  assert.equal(await status(statusOptions(), deps), 0)
  assert.ok(said.notes[0].includes(messages.reportCurrent))
})
