import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ModulesError,
  loadModules,
  findModule,
  parseModulesFlag,
  defaultCodes,
  groupBySource,
} from '../src/modules.js'

/** @type {string[]} */
const tempDirs = []

/**
 * @param {string} yaml
 * @returns {Promise<string>}
 */
async function writeModulesFile(yaml) {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-modules-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'modules.yaml')
  await writeFile(filePath, yaml, 'utf8')
  return filePath
}

/**
 * @param {import('../src/modules.js').ModuleDefinition[]} modules
 * @param {string} code
 */
function must(modules, code) {
  const module = findModule(modules, code)
  assert.ok(module, `expected module ${code}`)
  return module
}

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

test('loads and validates the real modules.yaml', async () => {
  const modules = await loadModules()
  assert.deepEqual(modules.map((module) => module.code), ['core-tools', 'method', 'cis'])
  assert.equal(must(modules, 'core-tools').always, true)
  const method = must(modules, 'method')
  assert.deepEqual(method.aliases, ['bmm'])
  assert.equal(method.default, true)
  assert.equal(method.record, 'bmod-method')
  assert.equal(method.source, 'bmad-code-org/BMAD-METHOD')
  assert.ok(method.message && method.message.length > 0)
})

test('parseModulesFlag reads comma-separated codes and aliases', async () => {
  const modules = await loadModules()
  assert.deepEqual(parseModulesFlag('method,cis', modules), ['method', 'cis'])
  assert.deepEqual(parseModulesFlag(' bmm , cis ', modules), ['method', 'cis'])
  assert.deepEqual(parseModulesFlag('method,bmm,cis,', modules), ['method', 'cis'])
  assert.deepEqual(parseModulesFlag('', modules), [])
})

test('parseModulesFlag names what it cannot resolve', async () => {
  const modules = await loadModules()
  assert.throws(
    () => parseModulesFlag('method,nope', modules),
    (error) => error instanceof ModulesError && error.message.includes('"nope"'),
  )
  assert.throws(
    () => parseModulesFlag('method:planning', modules),
    (error) => error instanceof ModulesError && error.message.includes('"method:planning"'),
  )
})

const ONE_DEFAULT_MODULE = `
modules:
  - code: one
    name: One
    description: First
    source: owner/repo
    record: bmod-one
  - code: two
    name: Two
    description: Second
    source: owner/repo
    record: bmod-two
    default: true
`

test('defaultCodes takes the default modules', async () => {
  assert.deepEqual(defaultCodes(await loadModules()), ['method'])
  assert.deepEqual(defaultCodes(await loadModules(await writeModulesFile(ONE_DEFAULT_MODULE))), ['two'])
})

test('groupBySource keeps modules.yaml order', async () => {
  const modules = await loadModules()
  const groups = groupBySource(modules)
  assert.deepEqual([...groups.keys()], [
    'bmad-code-org/BMAD-METHOD',
    'bmad-code-org/bmad-module-creative-intelligence-suite',
  ])
  assert.deepEqual(groups.get('bmad-code-org/BMAD-METHOD')?.map((module) => module.code), ['core-tools', 'method'])
  assert.deepEqual(groups.get('bmad-code-org/bmad-module-creative-intelligence-suite')?.map((module) => module.code), ['cis'])
})
