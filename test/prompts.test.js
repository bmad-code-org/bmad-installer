import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadMessages } from '../src/messages.js'
import { loadModules } from '../src/modules.js'
import { loadAgents } from '../src/agents.js'
import { agentPicker, modulePicker } from '../src/prompts.js'

/** @typedef {import('../src/modules.js').ModuleDefinition} ModuleDefinition */

const messages = await loadMessages()
const modules = await loadModules()

/** @param {string} code @returns {ModuleDefinition} */
function must(code) {
  const module = modules.find((entry) => entry.code === code)
  assert.ok(module, `expected module ${code}`)
  return module
}

const method = must('method')
const fresh = { installedCodes: /** @type {string[]} */ ([]), installedVersions: {} }

test('the module picker hides the always modules', () => {
  const picker = modulePicker(messages, modules, fresh)
  assert.deepEqual(picker.options.map((option) => option.value), ['method', 'toolsmith', 'founder', 'cis'])
  assert.equal(picker.options.some((option) => option.value === 'core-tools'), false)
})

test('a fresh install arrives with the default modules ticked', () => {
  const picker = modulePicker(messages, modules, fresh)
  assert.deepEqual(picker.initialValues, ['method', 'toolsmith'])
  assert.equal(picker.options[0].label, 'BMad Method')
  assert.equal(picker.options[0].hint, method.description)
})

test('an existing install ticks what is installed and labels its version', () => {
  const picker = modulePicker(messages, modules, {
    installedCodes: ['core-tools', 'cis'],
    installedVersions: { cis: '6.13.0-next' },
  })

  assert.deepEqual(picker.initialValues, ['cis'])
  assert.equal(picker.options[0].label, 'BMad Method')
  assert.equal(picker.options[3].label, `${must('cis').name} ${messages.installedSuffix.replace('{version}', '6.13.0-next')}`)
})

test('an installed module with no known version gets the plain suffix', () => {
  const picker = modulePicker(messages, modules, { installedCodes: ['method'], installedVersions: {} })
  assert.equal(picker.options[0].label, `BMad Method ${messages.installedSuffixNoVersion}`)
  assert.deepEqual(picker.initialValues, ['method'])
})

test('the agent picker shows the shared folder as one entry and the own-folder agents after it', async () => {
  const agents = await loadAgents()
  const picker = agentPicker(messages, agents, { initial: ['claude-code'], detected: ['universal', 'claude-code', 'augment'], found: ['cursor', 'claude-code', 'augment'] })
  const values = picker.options.map((option) => option.value)

  assert.deepEqual(values.slice(0, 3), ['claude-code', 'universal', 'augment'])
  assert.equal(values.includes('codex'), false)
  assert.equal(values.length, agents.filter((agent) => agent.skillsDir !== '.agents/skills').length + 1)
  assert.deepEqual(picker.initialValues, ['claude-code'])

  const shared = picker.options[1]
  assert.equal(shared.label, messages.universalLabel)
  assert.ok(shared.hint.startsWith('Cursor, '), shared.hint)
  assert.ok(/ and \d+ more$/.test(shared.hint), shared.hint)
  assert.equal(picker.options[0].hint, '.claude/skills, found on this machine')
  assert.ok(picker.searchText.universal.includes('codex'))
  assert.ok(picker.searchText['claude-code'].includes('claude code'))
})
