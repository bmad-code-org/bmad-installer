import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  chosenModules,
  moduleCalls,
  repeatCommand,
  requiredCodes,
  selectMigrations,
  versionMajor,
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

test('selectMigrations keeps only modules whose major actually moved', () => {
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
    before: { method: '6.13.0-next', 'core-tools': '6.13.0-next' },
    after: { method: '7.0.0', 'core-tools': '6.14.0' },
  })

  assert.deepEqual(kept, [migration({})])
  assert.deepEqual(selectMigrations(all, { before: {}, after: { method: '7.0.0' } }), [])
})

test('repeatCommand names the picked modules and the agents', () => {
  assert.equal(repeatCommand(chosenModules(['method', 'cis'], modules), ['universal', 'claude-code']), 'npx bmad-method install -m method,cis -t universal,claude-code -y')
  assert.equal(repeatCommand(chosenModules([], modules), ['universal']), 'npx bmad-method install -m core-tools -t universal -y')
})

test('a folder from --modules becomes a custom module after the listed ones, installed whole', async () => {
  const modules = await loadModules()
  const chosen = chosenModules(['acme/mods/skills/widgets', 'method'], modules)
  assert.deepEqual(chosen.map((module) => module.code), ['core-tools', 'method', 'acme/mods/skills/widgets'])
  assert.equal(chosen[2].custom, true)
  assert.deepEqual(moduleCalls(chosen, null).at(-1), { source: 'acme/mods/skills/widgets', skills: ['*'], label: 'acme/mods/skills/widgets' })
  assert.equal(repeatCommand(chosen, ['claude-code']), 'npx bmad-method install -m method,acme/mods/skills/widgets -t claude-code -y')
})

test('versionMajor reads the leading major version', () => {
  assert.equal(versionMajor('6.13.0-next'), '6')
  assert.equal(versionMajor('7.0.0'), '7')
  assert.equal(versionMajor('6'), '6')
  assert.equal(versionMajor('v6.1.0'), '6')
  assert.equal(versionMajor(''), null)
  assert.equal(versionMajor('unknown'), null)
})

test('a code picked with a ref comes from that branch, is re-added even when installed, and repeats with its ref', () => {
  const chosen = chosenModules(['core-tools#dev', 'method#dev', 'cis'], modules)
  assert.deepEqual(chosen.map((module) => [module.code, module.source]), [
    ['core-tools', 'bmad-code-org/BMAD-METHOD/skills/core-tools#dev'],
    ['method', 'bmad-code-org/BMAD-METHOD/skills/method#dev'],
    ['cis', 'bmad-code-org/bmad-module-creative-intelligence-suite'],
  ])
  const installed = statusOf()
  for (const entry of installed.modules) entry.absent_skills = []
  assert.deepEqual(moduleCalls(chosen, installed).map((call) => call.label), ['BMad Core Tools', 'BMad Method', 'BMad Creative Intelligence Suite'])
  assert.deepEqual(moduleCalls(chosenModules(['method'], modules), installed), [])
  assert.equal(repeatCommand(chosen, ['claude-code']), 'npx bmad-method install -m core-tools#dev,method#dev,cis -t claude-code -y')
})

test('a picked module brings the modules it requires, unless they were picked too', () => {
  assert.deepEqual(requiredCodes(['bmad-loop'], modules), ['method'])
  assert.deepEqual(requiredCodes(['bmad-loop', 'method#dev'], modules), [])
  assert.deepEqual(requiredCodes(['cis'], modules), [])
  assert.deepEqual(chosenModules(['bmad-loop'], modules).map((module) => module.code), ['core-tools', 'method', 'bmad-loop'])
  const withRef = chosenModules(['bmad-loop', 'method#dev'], modules)
  assert.equal(withRef[1].source, 'bmad-code-org/BMAD-METHOD/skills/method#dev')
})

test('repeatCommand quotes a module list a shell would split', () => {
  const chosen = chosenModules(['/work/My Modules/widgets'], modules)
  assert.equal(repeatCommand(chosen, ['claude-code']), "npx bmad-method install -m '/work/My Modules/widgets' -t claude-code -y")
  assert.equal(repeatCommand(chosenModules(["/work/o'brien"], modules), ['codex']), "npx bmad-method install -m '/work/o'\\''brien' -t codex -y")
  assert.equal(repeatCommand(chosenModules(['method#feature/x', 'acme/mods'], modules), ['codex']), 'npx bmad-method install -m method#feature/x,acme/mods -t codex -y')
})

test('chosenModules gives a ref with a slash to the listed module', () => {
  const chosen = chosenModules(['method#feature/install'], modules)
  assert.deepEqual(chosen.map((module) => module.source), [
    'bmad-code-org/BMAD-METHOD/skills/core-tools',
    'bmad-code-org/BMAD-METHOD/skills/method#feature/install',
  ])
})
