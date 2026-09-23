import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadMessages } from '../src/messages.js'
import { loadModules } from '../src/modules.js'
import { bundlePicker, modulePicker } from '../src/prompts.js'

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
  assert.deepEqual(picker.options.map((option) => option.value), ['method', 'cis'])
  assert.equal(picker.options.some((option) => option.value === 'core-tools'), false)
})

test('a fresh install arrives with the default modules ticked', () => {
  const picker = modulePicker(messages, modules, fresh)
  assert.deepEqual(picker.initialValues, ['method'])
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
  assert.equal(picker.options[1].label, `${must('cis').name} ${messages.installedSuffix.replace('{version}', '6.13.0-next')}`)
})

test('an installed module with no known version gets the plain suffix', () => {
  const picker = modulePicker(messages, modules, { installedCodes: ['method'], installedVersions: {} })
  assert.equal(picker.options[0].label, `BMad Method ${messages.installedSuffixNoVersion}`)
  assert.deepEqual(picker.initialValues, ['method'])
})

test('the bundle picker offers every bundle and ticks the default ones', () => {
  const picker = bundlePicker(method, { installedSkills: [] })
  assert.deepEqual(picker.options.map((option) => option.value), ['planning', 'build', 'agents', 'extras'])
  assert.deepEqual(picker.initialValues, ['planning', 'build', 'agents'])
})

test('a bundle whose skills are all installed is ticked even when it is not a default', () => {
  const extras = method.bundles?.find((bundle) => bundle.code === 'extras')
  assert.ok(extras)
  const picker = bundlePicker(method, { installedSkills: extras.skills })
  assert.deepEqual(picker.initialValues, ['planning', 'build', 'agents', 'extras'])

  const partial = bundlePicker(method, { installedSkills: extras.skills.slice(0, 1) })
  assert.equal(partial.initialValues.includes('extras'), false)
})

test('a module without bundles offers nothing', () => {
  assert.deepEqual(bundlePicker(must('cis'), { installedSkills: [] }), { options: [], initialValues: [] })
})
