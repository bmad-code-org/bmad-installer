import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModulesError, findModule, loadModules, overrideSource } from '../src/modules.js'

const SOURCE_OVERRIDE = 'BMAD_INSTALLER_SOURCE_OVERRIDE'

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
 * @param {string} yaml
 * @param {string} reason
 */
async function assertInvalid(yaml, reason) {
  const filePath = await writeModulesFile(yaml)
  await assert.rejects(
    loadModules(filePath),
    (error) => error instanceof ModulesError && error.message.includes(reason),
  )
}

after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

const VALID = `
modules:
  - code: one
    name: One
    description: First
    source: owner/repo
    record: bmod-one
    always: true
  - code: two
    aliases: [dos]
    name: Two
    description: Second
    source: owner/other-repo
    record: bmod-two
    default: true
    deprecated: use one instead
`

test('findModule matches codes and aliases', async () => {
  const modules = await loadModules(await writeModulesFile(VALID))
  assert.equal(findModule(modules, 'two')?.code, 'two')
  assert.equal(findModule(modules, 'dos')?.code, 'two')
  assert.equal(findModule(modules, 'nope'), undefined)
})

test('validation rejects malformed files', async () => {
  await assertInvalid('modules: []', 'non-empty array')
  await assertInvalid('other: 1', 'non-empty array')
  await assertInvalid('modules:\n  - name: One\n', 'code must be a non-empty string')
  await assertInvalid(
    'modules:\n  - code: one\n    name: One\n    description: d\n    source: not-a-repo\n    record: r\n',
    'owner/repo',
  )
  await assertInvalid(
    'modules:\n  - code: one\n    name: One\n    description: d\n    source: o/r\n',
    'record must be a non-empty string',
  )
  await assertInvalid(`${VALID}\n  - code: one\n    name: Dup\n    description: d\n    source: o/r\n    record: r\n`, 'already used')
  await assertInvalid(`${VALID}\n  - code: dos\n    name: Dup\n    description: d\n    source: o/r\n    record: r\n`, 'already used')
  await assertInvalid(`${VALID}\n  - code: three\n    name: Three\n    description: d\n    source: o/r\n    record: r\n    requires: [nope]\n`, 'not a module code')
  await assertInvalid(`${VALID}\n  - code: three\n    name: Three\n    description: d\n    source: o/r\n    record: r\n    requires: one\n`, 'list of module codes')
})

test('requires names other module codes', async () => {
  const modules = await loadModules(await writeModulesFile(`${VALID}\n  - code: three\n    name: Three\n    description: d\n    source: o/r\n    record: r\n    requires: [two]\n`))
  assert.deepEqual(findModule(modules, 'three')?.requires, ['two'])
})

test('the source override swaps the repository of the core modules and keeps their folders', async () => {
  const previous = process.env[SOURCE_OVERRIDE]
  process.env[SOURCE_OVERRIDE] = '/tmp/local-checkout'
  try {
    const sources = Object.fromEntries((await loadModules()).map((module) => [module.code, module.source]))
    assert.equal(sources['core-tools'], '/tmp/local-checkout/skills/core-tools')
    assert.equal(sources.founder, '/tmp/local-checkout/skills/founder')
    assert.equal(sources.creative, '/tmp/local-checkout/skills/creative')
    assert.equal(sources.tea, 'bmad-code-org/bmad-method-test-architecture-enterprise/skills')
    await assertInvalid(
      'modules:\n  - code: one\n    name: One\n    description: d\n    source: nope\n    record: r\n',
      'owner/repo',
    )
  } finally {
    if (previous === undefined) delete process.env[SOURCE_OVERRIDE]
    else process.env[SOURCE_OVERRIDE] = previous
  }
})

test('overrideSource puts a ref after the folder and leaves other repositories alone', () => {
  const repo = 'o/r'
  assert.equal(overrideSource('o/r/skills/method', 'o/r#dev', repo), 'o/r/skills/method#dev')
  assert.equal(overrideSource('o/r', '/local/', repo), '/local')
  assert.equal(overrideSource('x/y/skills/a', '/local', repo), 'x/y/skills/a')
})
