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

test('the agent picker lists every agent by name, preselected first, then in table order', async () => {
  const agents = await loadAgents()
  const picker = agentPicker(agents, { initial: ['cursor', 'augment'] })
  const values = picker.options.map((option) => option.value)
  const rest = agents.filter((agent) => !['universal', 'cursor', 'augment'].includes(agent.id)).map((agent) => agent.id)

  assert.deepEqual(values, ['augment', 'cursor', ...rest])
  assert.ok(values.includes('codex') && values.includes('gemini-cli'))
  assert.equal(values.includes('universal'), false)
  assert.equal(values.length, agents.length - 1)
  assert.deepEqual(picker.initialValues, ['cursor', 'augment'])
  assert.equal(picker.options[1].label, 'Cursor')
  assert.equal(picker.options[1].hint, '.agents/skills')
  assert.equal(picker.options[0].label, 'Augment')
})
