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
  defaultChoices,
  bundleCodes,
  skillsToInstall,
  groupBySource,
} from '../src/modules.js'

const METHOD_RECORD_SKILLS = [
  'bmad-agent-analyst', 'bmad-agent-architect', 'bmad-agent-dev', 'bmad-agent-pm',
  'bmad-agent-ux-designer', 'bmad-architecture', 'bmad-build', 'bmad-build-auto',
  'bmad-code-review', 'bmad-correct-course', 'bmad-create-epics-and-stories', 'bmad-prd',
  'bmad-preview-ticketing', 'bmad-prfaq', 'bmad-product-brief', 'bmad-project-context',
  'bmad-qa-generate-e2e-tests', 'bmad-retrospective', 'bmad-spec', 'bmad-sprint-planning',
  'bmad-ux', 'bmad-walkthrough',
]

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
  assert.equal(must(modules, 'core-tools').bundles, undefined)
  const method = must(modules, 'method')
  assert.deepEqual(method.aliases, ['bmm'])
  assert.equal(method.default, true)
  assert.equal(method.record, 'bmod-method')
  assert.equal(method.source, 'bmad-code-org/BMAD-METHOD')
  assert.ok(method.message && method.message.length > 0)
  assert.deepEqual(bundleCodes(method, () => true), ['planning', 'build', 'agents', 'extras'])
  assert.equal(must(modules, 'cis').bundles, undefined)
})

test('the method bundles cover the record skill list exactly', async () => {
  const method = must(await loadModules(), 'method')
  const all = bundleCodes(method, () => true)
  const { install, unknown } = skillsToInstall(method, all, METHOD_RECORD_SKILLS)
  assert.deepEqual(unknown, [])
  assert.deepEqual([...install].sort(), [...METHOD_RECORD_SKILLS].sort())
  assert.equal(install.length, METHOD_RECORD_SKILLS.length)
})

test('parseModulesFlag reads the code:bundle+bundle,code grammar', async () => {
  const modules = await loadModules()
  assert.deepEqual(parseModulesFlag('method:planning+build,cis', modules), [
    { code: 'method', bundles: ['planning', 'build'] },
    { code: 'cis', bundles: null },
  ])
  assert.deepEqual(parseModulesFlag(' method : planning + extras , cis ', modules), [
    { code: 'method', bundles: ['planning', 'extras'] },
    { code: 'cis', bundles: null },
  ])
  assert.deepEqual(parseModulesFlag('bmm', modules), [
    { code: 'method', bundles: ['planning', 'build', 'agents'] },
  ])
  assert.deepEqual(parseModulesFlag('cis,', modules), [{ code: 'cis', bundles: null }])
  assert.deepEqual(parseModulesFlag('method:planning,method:build+planning', modules), [
    { code: 'method', bundles: ['planning', 'build'] },
  ])
  assert.deepEqual(parseModulesFlag('', modules), [])
})

test('parseModulesFlag names what it cannot resolve', async () => {
  const modules = await loadModules()
  assert.throws(
    () => parseModulesFlag('method,nope', modules),
    (error) => error instanceof ModulesError && error.message.includes('"nope"'),
  )
  assert.throws(
    () => parseModulesFlag('method:planning+nope', modules),
    (error) => error instanceof ModulesError && error.message.includes('"nope"') && error.message.includes('"method"'),
  )
  assert.throws(
    () => parseModulesFlag('cis:planning', modules),
    (error) => error instanceof ModulesError && error.message.includes('"planning"'),
  )
})

const ONE_DEFAULT_MODULE = `
modules:
  - code: two
    name: Two
    description: Second
    source: owner/repo
    record: bmod-two
    default: true
    bundles:
      - code: a
        name: A
        description: Bundle A
        default: true
        skills: [s1]
      - code: b
        name: B
        description: Bundle B
        skills: [s2]
`

test('defaultChoices takes default modules with their default bundles', async () => {
  assert.deepEqual(defaultChoices(await loadModules()), [
    { code: 'method', bundles: ['planning', 'build', 'agents'] },
  ])
  const other = await loadModules(await writeModulesFile(ONE_DEFAULT_MODULE))
  assert.deepEqual(defaultChoices(other), [{ code: 'two', bundles: ['a'] }])
})

test('bundleCodes filters', async () => {
  const method = must(await loadModules(), 'method')
  assert.deepEqual(bundleCodes(method, (bundle) => bundle.default === true), ['planning', 'build', 'agents'])
  assert.deepEqual(bundleCodes(method, (bundle) => bundle.default !== true), ['extras'])
})

test('skillsToInstall without bundles takes the whole record list', async () => {
  const modules = await loadModules()
  const cis = must(modules, 'cis')
  const record = ['bmad-cis-storytelling', 'bmad-cis-design-thinking']
  assert.deepEqual(skillsToInstall(cis, null, record), { install: record, unknown: [] })
  assert.deepEqual(skillsToInstall(must(modules, 'method'), null, record), { install: record, unknown: [] })
})

test('skillsToInstall keeps module order and reports unknown skills', async () => {
  const method = must(await loadModules(), 'method')
  const { install, unknown } = skillsToInstall(method, ['build', 'planning'], METHOD_RECORD_SKILLS)
  assert.deepEqual(install.slice(0, 7), [
    'bmad-product-brief', 'bmad-prfaq', 'bmad-prd', 'bmad-ux',
    'bmad-architecture', 'bmad-spec', 'bmad-project-context',
  ])
  assert.equal(install[7], 'bmad-create-epics-and-stories')
  assert.deepEqual(unknown, [])

  const partial = skillsToInstall(method, ['extras'], ['bmad-walkthrough'])
  assert.deepEqual(partial.install, ['bmad-walkthrough'])
  assert.deepEqual(partial.unknown, ['bmad-preview-ticketing'])
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
