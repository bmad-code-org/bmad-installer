import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moduleSourceFromLock, readProjectLock } from '../src/project-lock.js'

test('moduleSourceFromLock gives the folder above the record, on its source and ref', () => {
  const github = { source: 'acme/mods', sourceType: 'github', ref: 'dev', skillPath: 'skills/widgets/bmod-widgets/SKILL.md' }
  assert.equal(moduleSourceFromLock(github, '/work/app'), 'acme/mods/skills/widgets#dev')
  assert.equal(moduleSourceFromLock({ ...github, ref: undefined, skillPath: 'bmod-widgets/SKILL.md' }, '/work/app'), 'acme/mods')
  assert.equal(moduleSourceFromLock({ source: '../mods', sourceType: 'local', skillPath: 'widgets/bmod-widgets/SKILL.md' }, '/work/app'), '/work/mods/widgets')
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
