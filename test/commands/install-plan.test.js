import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  chosenModules,
  moduleCalls,
  repeatCommand,
  selectMigrations,
  versionsByCode,
} from '../../src/commands/install-plan.js'
import { loadModules } from '../../src/modules.js'

/** @typedef {import('../../src/bmad-scripts.js').Migration} Migration */
/** @typedef {import('../../src/bmad-scripts.js').StatusReport} StatusReport */

const modules = await loadModules()
const fixture = JSON.parse(await readFile(new URL('../fixtures/status-fresh.json', import.meta.url), 'utf8'))

/** @returns {StatusReport} */
function statusOf() {
  return structuredClone(fixture)
}

test('chosenModules adds the always modules, follows modules.yaml order and drops unknown codes', () => {
  const codes = (/** @type {string[]} */ picked) => chosenModules(picked, modules).map((module) => module.code)
  assert.deepEqual(codes(['cis', 'method', 'gone']), ['core-tools', 'method', 'cis'])
  assert.deepEqual(codes([]), ['core-tools'])
})

test('moduleCalls asks for every skill in each chosen module folder, in modules.yaml order', () => {
  const calls = moduleCalls(chosenModules(['founder', 'method'], modules), null)
  assert.deepEqual(calls, [
    { source: 'bmad-code-org/BMAD-METHOD/skills/core-tools', skills: ['*'], label: 'BMad Core Tools' },
    { source: 'bmad-code-org/BMAD-METHOD/skills/method', skills: ['*'], label: 'BMad Method' },
    { source: 'bmad-code-org/BMAD-METHOD/skills/founder', skills: ['*'], label: 'BMad Founder' },
  ])
})

test('moduleCalls leaves out a module installed with nothing missing and redoes one with gaps', () => {
  const report = statusOf()
  report.modules[0].absent_skills = []
  const calls = moduleCalls(chosenModules(['method'], modules), report)
  assert.deepEqual(calls.map((call) => call.label), ['BMad Method'])

  report.modules[1].absent_skills = []
  assert.deepEqual(moduleCalls(chosenModules(['method'], modules), report), [])
})

test('versionsByCode maps the status entries and tolerates no status', () => {
  assert.deepEqual(versionsByCode(statusOf()), { 'core-tools': '6.13.0-next', method: '6.13.0-next' })
  assert.deepEqual(versionsByCode(null), {})
})

test('selectMigrations keeps only chosen modules whose major actually moved', () => {
  /** @param {Partial<Migration>} patch @returns {Migration} */
  const migration = (patch) => ({
    module: 'method', path: 'm.toml', file: '/p/m.toml', from: '6', to: '7', title: 'Move', ...patch,
  })
  const all = [
    migration({}),
    migration({ from: '5' }),
    migration({ module: 'cis' }),
    migration({ module: 'core-tools' }),
  ]
  const kept = selectMigrations(all, {
    codes: ['core-tools', 'method'],
    before: { method: '6.13.0-next', 'core-tools': '6.13.0-next' },
    after: { method: '7.0.0', 'core-tools': '6.14.0' },
  })

  assert.deepEqual(kept, [migration({})])
  assert.deepEqual(selectMigrations(all, { codes: ['method'], before: {}, after: { method: '7.0.0' } }), [])
})

test('repeatCommand names the picked modules and the agents', () => {
  assert.equal(repeatCommand(chosenModules(['method', 'cis'], modules), ['universal', 'claude-code']), 'npx bmad-method install -m method,cis -t universal,claude-code -y')
  assert.equal(repeatCommand(chosenModules([], modules), ['universal']), 'npx bmad-method install -m core-tools -t universal -y')
})
