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
  isModuleSource,
  normalizeSource,
} from '../src/modules.js'
import { homedir } from 'node:os'

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
  assert.deepEqual(modules.map((module) => module.code), ['core-tools', 'method', 'toolsmith', 'founder', 'cis'])
  assert.equal(must(modules, 'core-tools').always, true)
  const method = must(modules, 'method')
  assert.deepEqual(method.aliases, ['bmm'])
  assert.equal(method.default, true)
  assert.equal(method.record, 'bmod-method')
  assert.equal(method.source, 'bmad-code-org/BMAD-METHOD/skills/method')
  assert.equal(must(modules, 'founder').record, 'bmad-founder-agent-advisor')
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
  assert.deepEqual(defaultCodes(await loadModules()), ['method', 'toolsmith'])
  assert.deepEqual(defaultCodes(await loadModules(await writeModulesFile(ONE_DEFAULT_MODULE))), ['two'])
})

test('parseModulesFlag takes a folder for a module not on the list', async () => {
  const modules = await loadModules()
  assert.deepEqual(parseModulesFlag('method,acme/mods/skills/widgets#dev', modules), ['method', 'acme/mods/skills/widgets#dev'])
  assert.deepEqual(parseModulesFlag('https://git.example.com/acme/mods.git', modules), ['https://git.example.com/acme/mods.git'])
  assert.deepEqual(parseModulesFlag('./widgets', modules), [join(process.cwd(), 'widgets')])
})

test('isModuleSource and normalizeSource tell a source from a code and make local paths absolute', () => {
  assert.equal(isModuleSource('method'), false)
  assert.equal(isModuleSource('acme/mods'), true)
  assert.equal(isModuleSource('C:\\mods\\widgets'), true)
  assert.equal(normalizeSource('../widgets', '/work/app'), '/work/widgets')
  assert.equal(normalizeSource('~/mods/widgets', '/work/app'), join(homedir(), 'mods', 'widgets'))
  assert.equal(normalizeSource('acme/mods/skills/widgets', '/work/app'), 'acme/mods/skills/widgets')
})
