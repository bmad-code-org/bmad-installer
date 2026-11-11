import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  chosenModules,
  memberCalls,
  recordCalls,
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

test('recordCalls puts bmad in the first source call and one call per source', () => {
  const chosen = chosenModules(['method', 'cis'], modules)
  const calls = recordCalls(chosen, 'bmad')

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    source: 'bmad-code-org/BMAD-METHOD',
    skills: ['bmad', 'bmod-core-tools', 'bmod-method'],
    label: 'BMad Core Tools, BMad Method',
  })
  assert.deepEqual(calls[1], {
    source: 'bmad-code-org/bmad-module-creative-intelligence-suite',
    skills: ['bmod-cis'],
    label: 'BMad Creative Intelligence Suite',
  })
})

test('recordCalls leaves out records already in the project and drops empty calls', () => {
  const chosen = chosenModules(['method', 'cis'], modules)

  const partial = recordCalls(chosen, 'bmad', ['bmad', 'bmod-core-tools'])
  assert.deepEqual(partial.map((call) => call.skills), [['bmod-method'], ['bmod-cis']])

  const onlyCis = recordCalls(chosen, 'bmad', ['bmad', 'bmod-core-tools', 'bmod-method'])
  assert.deepEqual(onlyCis.map((call) => call.skills), [['bmod-cis']])

  assert.deepEqual(recordCalls(chosen, 'bmad', ['bmad', 'bmod-core-tools', 'bmod-method', 'bmod-cis']), [])
})

test('memberCalls takes every absent skill the record lists', () => {
  const report = statusOf()
  report.modules[1].skills = ['bmad-agent-pm']
  report.modules[1].absent_skills = report.modules[1].absent_skills.filter((name) => name !== 'bmad-agent-pm')
  const calls = memberCalls(chosenModules(['method'], modules), report)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].label, 'BMad Core Tools, BMad Method')
  assert.deepEqual(calls[0].skills, [...statusOf().modules[0].absent_skills, ...report.modules[1].absent_skills])
})

test('memberCalls labels a one-module call with the module name and skips modules with nothing absent', () => {
  const report = statusOf()
  report.modules[1].absent_skills = []
  const calls = memberCalls(chosenModules(['method'], modules), report)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].label, 'BMad Core Tools')
  assert.deepEqual(calls[0].skills, statusOf().modules[0].absent_skills)
})

test('memberCalls ignores a chosen module the status does not know', () => {
  const report = statusOf()
  report.modules = []
  assert.deepEqual(memberCalls(chosenModules(['cis'], modules), report), [])
})

test('a module of one skill installs in its record call and needs no member call', () => {
  /** @type {import('../../src/modules.js').ModuleDefinition[]} */
  const withSolo = [...modules, { code: 'solo', name: 'Solo', description: 'd', source: 'owner/solo', record: 'bmad-solo' }]
  const chosen = chosenModules(['solo'], withSolo)

  assert.deepEqual(recordCalls(chosen, 'bmad').at(-1), { source: 'owner/solo', skills: ['bmad-solo'], label: 'Solo' })

  const report = statusOf()
  report.modules[0].absent_skills = []
  report.modules.push({ ...report.modules[1], module: 'solo', folder: 'bmad-solo', skills: ['bmad-solo'], absent_skills: [] })
  assert.deepEqual(memberCalls(chosen, report), [])
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
