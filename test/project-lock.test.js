import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { lockedRef, moduleSourceFromLock, readProjectLock } from '../src/project-lock.js'

test('moduleSourceFromLock gives the folder above the record, on its source and ref', () => {
  const github = { source: 'acme/mods', sourceType: 'github', ref: 'dev', skillPath: 'skills/widgets/bmod-widgets/SKILL.md' }
  assert.equal(moduleSourceFromLock(github, '/work/app'), 'acme/mods/skills/widgets#dev')
  assert.equal(moduleSourceFromLock({ ...github, ref: undefined, skillPath: 'bmod-widgets/SKILL.md' }, '/work/app'), 'acme/mods')
  assert.equal(moduleSourceFromLock({ source: '../mods', sourceType: 'local', skillPath: 'widgets/bmod-widgets/SKILL.md' }, '/work/app'), join(resolve('/work/app', '../mods'), 'widgets'))
  assert.equal(moduleSourceFromLock({ source: '../mods/widgets', sourceType: 'local' }, '/work/app'), resolve('/work/app', '../mods/widgets'))
  assert.equal(
    moduleSourceFromLock({ source: 'acme/mods', sourceUrl: 'https://git.example.com/acme/mods.git', sourceType: 'git', ref: 'v2', skillPath: 'skills/widgets/bmod-widgets/SKILL.md' }, '/work/app'),
    'https://git.example.com/acme/mods.git#v2',
  )
})

test('moduleSourceFromLock gives null for what cannot be installed again from a folder', () => {
  assert.equal(moduleSourceFromLock(undefined, '/work/app'), null)
  assert.equal(moduleSourceFromLock({ source: 'acme/mods', sourceType: 'git' }, '/work/app'), null)
  assert.equal(moduleSourceFromLock({ source: 'https://example.com', sourceType: 'well-known' }, '/work/app'), null)
})

test('readProjectLock reads the skills map and is empty without a lock', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual(await readProjectLock(dir), {})
  await writeFile(join(dir, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { bmad: { source: 'a/b' } } }))
  assert.deepEqual(await readProjectLock(dir), { bmad: { source: 'a/b' } })
})

test('lockedRef gives the ref a listed module was installed from, only for its own repository', () => {
  const source = 'bmad-code-org/BMAD-METHOD/skills/method'
  const entry = { source: 'bmad-code-org/BMAD-METHOD', sourceType: 'github', ref: 'dev', skillPath: 'skills/bmod-method/SKILL.md' }
  assert.equal(lockedRef(entry, source), 'dev')
  assert.equal(lockedRef({ ...entry, ref: undefined }, source), undefined)
  assert.equal(lockedRef({ ...entry, source: 'someone/fork' }, source), undefined)
  assert.equal(lockedRef({ ...entry, sourceType: 'local' }, source), undefined)
  assert.equal(lockedRef(entry, `${source}#main`), undefined, 'a ref already on the source wins')
  assert.equal(lockedRef(undefined, source), undefined)
})
