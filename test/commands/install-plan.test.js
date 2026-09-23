import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  chosenModules,
  memberCalls,
  orderedChoices,
  recordCalls,
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

test('orderedChoices adds the always modules and follows modules.yaml order', () => {
  assert.deepEqual(orderedChoices([{ code: 'cis', bundles: null }, { code: 'method', bundles: ['build'] }], modules), [
    { code: 'core-tools', bundles: null },
    { code: 'method', bundles: ['build'] },
    { code: 'cis', bundles: null },
  ])
  assert.deepEqual(orderedChoices([], modules), [{ code: 'core-tools', bundles: null }])
})

test('chosenModules resolves the definitions and drops unknown codes', () => {
  const chosen = chosenModules([{ code: 'method', bundles: null }, { code: 'gone', bundles: null }], modules)
  assert.deepEqual(chosen.map((module) => module.code), ['method'])
})

test('recordCalls puts bmad in the first source call and one call per source', () => {
  const chosen = chosenModules(orderedChoices([{ code: 'method', bundles: [] }, { code: 'cis', bundles: null }], modules), modules)
  const calls = recordCalls(chosen, 'bmad')

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    source: 'bmad-code-org/BMAD-METHOD',
    skills: ['bmad', 'bmod-core-tools', 'bmod-method'],
    label: 'bmad-code-org/BMAD-METHOD',
  })
  assert.deepEqual(calls[1], {
    source: 'bmad-code-org/bmad-module-creative-intelligence-suite',
    skills: ['bmod-cis'],
    label: 'BMad Creative Intelligence Suite',
  })
})

test('recordCalls leaves out records already in the project and drops empty calls', () => {
  const chosen = chosenModules(orderedChoices([{ code: 'method', bundles: [] }, { code: 'cis', bundles: null }], modules), modules)

  const partial = recordCalls(chosen, 'bmad', ['bmad', 'bmod-core-tools'])
  assert.deepEqual(partial.map((call) => call.skills), [['bmod-method'], ['bmod-cis']])

  const onlyCis = recordCalls(chosen, 'bmad', ['bmad', 'bmod-core-tools', 'bmod-method'])
  assert.deepEqual(onlyCis.map((call) => call.skills), [['bmod-cis']])

  assert.deepEqual(recordCalls(chosen, 'bmad', ['bmad', 'bmod-core-tools', 'bmod-method', 'bmod-cis']), [])
})

test('memberCalls leaves out bundle skills that are already installed without calling them unknown', () => {
  const report = statusOf()
  report.modules[1].skills = ['bmad-prd']
  report.modules[1].absent_skills = report.modules[1].absent_skills.filter((name) => name !== 'bmad-prd')
  const { calls, unknown } = memberCalls([{ code: 'method', bundles: ['planning'] }], modules, report)

  assert.deepEqual(unknown, [])
  assert.equal(calls[0].skills.includes('bmad-prd'), false)
  assert.ok(calls[0].skills.includes('bmad-product-brief'))
})

test('memberCalls takes the absent skills of a module without bundles', () => {
  const { calls, unknown } = memberCalls([{ code: 'core-tools', bundles: null }], modules, statusOf())

  assert.deepEqual(unknown, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].label, 'BMad Core Tools')
  assert.deepEqual(calls[0].skills, statusOf().modules[0].absent_skills)
})

test('memberCalls unions the chosen bundles and names what the record dropped', () => {
  const report = statusOf()
  report.modules[1].absent_skills = report.modules[1].absent_skills.filter((name) => name !== 'bmad-ux')
  const { calls, unknown } = memberCalls([{ code: 'method', bundles: ['planning', 'agents'] }], modules, report)

  assert.deepEqual(unknown, [{ module: 'BMad Method', skills: ['bmad-ux'] }])
  assert.ok(calls[0].skills.includes('bmad-prd'))
  assert.ok(calls[0].skills.includes('bmad-agent-dev'))
  assert.equal(calls[0].skills.includes('bmad-build'), false)
  assert.equal(calls[0].skills.includes('bmad-ux'), false)
})

test('memberCalls merges modules that share a source and skips empty ones', () => {
  const report = statusOf()
  report.modules[0].absent_skills = []
  const { calls } = memberCalls(
    [{ code: 'core-tools', bundles: null }, { code: 'method', bundles: ['extras'] }],
    modules,
    report,
  )

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].skills, ['bmad-preview-ticketing', 'bmad-walkthrough'])
  assert.equal(calls[0].label, 'BMad Method')
})

test('memberCalls ignores a chosen module the status does not know', () => {
  assert.deepEqual(memberCalls([{ code: 'cis', bundles: null }], modules, statusOf()), { calls: [], unknown: [] })
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
