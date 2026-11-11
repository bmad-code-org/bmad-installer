import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BMAD_SKILL,
  hasSkills,
  inspectInstall,
  installedModuleCodes,
} from '../src/installed.js'
import { loadModules } from '../src/modules.js'

/** @typedef {import('../src/skills-cli.js').ListedSkill} ListedSkill */

/**
 * @param {string} name
 * @param {string} path
 * @returns {ListedSkill}
 */
function listed(name, path) {
  return { name, path, scope: 'project', agents: ['Claude Code'], source: 'bmad-code-org/BMAD-METHOD' }
}

/** @param {ListedSkill[]} skills */
function fakeSkillsCli(skills) {
  /** @type {{ cwd: string }[]} */
  const calls = []
  return {
    calls,
    /** @param {{ cwd: string }} options */
    async list(options) {
      calls.push(options)
      return skills
    },
  }
}

async function tempDir() {
  return await mkdtemp(join(tmpdir(), 'bmad-installed-'))
}

test('inspectInstall finds the bmad skill directory', async () => {
  const dir = await tempDir()
  const skillsCli = fakeSkillsCli([
    listed(BMAD_SKILL, join(dir, '.agents', 'skills', 'bmad')),
    listed('bmod-core-tools', join(dir, '.agents', 'skills', 'bmod-core-tools')),
    listed('bmod-method', join(dir, '.agents', 'skills', 'bmod-method')),
    listed('bmad-prd', join(dir, '.agents', 'skills', 'bmad-prd')),
  ])

  const state = await inspectInstall(dir, skillsCli)

  assert.equal(state.bmadSkillDir, join(dir, '.agents', 'skills', 'bmad'))
  assert.equal(state.skills.length, 4)
  assert.equal(state.legacyManifest, false)
  assert.deepEqual(skillsCli.calls, [{ cwd: dir }])

  await rm(dir, { recursive: true, force: true })
})

test('inspectInstall reports no bmad skill when it is absent', async () => {
  const dir = await tempDir()
  const state = await inspectInstall(dir, fakeSkillsCli([listed('bmod-cis', join(dir, 'bmod-cis'))]))

  assert.equal(state.bmadSkillDir, null)

  await rm(dir, { recursive: true, force: true })
})

test('inspectInstall detects a legacy manifest', async () => {
  const dir = await tempDir()
  await mkdir(join(dir, '_bmad', '_config'), { recursive: true })
  await writeFile(join(dir, '_bmad', '_config', 'manifest.yaml'), 'modules: []\n')

  const state = await inspectInstall(dir, fakeSkillsCli([]))

  assert.equal(state.legacyManifest, true)
  assert.deepEqual(state.skills, [])

  await rm(dir, { recursive: true, force: true })
})

test('installedModuleCodes matches installed skills against each module record', async () => {
  const modules = await loadModules()
  /** @param {string[]} names */
  const stateOf = (names) => ({ skills: names.map((name) => listed(name, `/s/${name}`)), bmadSkillDir: null, legacyManifest: false })

  assert.deepEqual(installedModuleCodes(stateOf(['bmad', 'bmod-core-tools', 'bmod-cis', 'bmod-other']), modules), ['core-tools', 'cis'])
  assert.deepEqual(installedModuleCodes(stateOf(['bmad', 'bmad-agent-pm']), modules), [])

  const solo = [{ code: 'solo', name: 'Solo', description: 'd', source: 'o/r', record: 'bmad-solo' }]
  assert.deepEqual(installedModuleCodes(stateOf(['bmad-solo']), solo), ['solo'])
})

test('hasSkills checks every requested name', () => {
  /** @type {import('../src/installed.js').InstalledState} */
  const state = {
    skills: [listed('bmad', '/s/bmad'), listed('bmod-method', '/s/bmod-method')],
    bmadSkillDir: '/s/bmad',
    legacyManifest: false,
  }

  assert.equal(hasSkills(state, ['bmad', 'bmod-method']), true)
  assert.equal(hasSkills(state, []), true)
  assert.equal(hasSkills(state, ['bmad', 'bmad-prd']), false)
})
