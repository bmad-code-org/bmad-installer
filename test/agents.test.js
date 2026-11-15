import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentsError, agentsHolding, collapseUniversal, detectAgents, loadAgents, parseToolsFlag, sharedFolderHolds } from '../src/agents.js'
import { AGENTS_FILE, generateAgents } from '../tools/generate-agents.js'

const agents = await loadAgents()
const HOME = '/home/user'
const PROJECT = '/work/app'

/** @param {string[]} paths */
function contextWith(paths) {
  const existing = new Set(paths)
  return { home: HOME, project: PROJECT, exists: (/** @type {string} */ path) => existing.has(path) }
}

test('agents.json matches the agent table of the installed skills CLI', async () => {
  const shipped = JSON.parse(await readFile(AGENTS_FILE, 'utf8'))
  const fresh = await generateAgents()
  assert.equal(shipped.skillsVersion, fresh.skillsVersion, 'skills was bumped: run npm run agents')
  assert.deepEqual(shipped, fresh, 'agents.json is stale: run npm run agents')
})

test('the agent list carries the ids the installer leans on and leaves out eve', () => {
  const ids = agents.map((agent) => agent.id)
  for (const id of ['claude-code', 'codex', 'cursor', 'universal']) assert.ok(ids.includes(id), `missing ${id}`)
  assert.equal(ids.includes('eve'), false)
  assert.equal(new Set(ids).size, ids.length)
})

test('detectAgents expands home and project paths', () => {
  assert.deepEqual(detectAgents(agents, contextWith([])), [])
  assert.deepEqual(detectAgents(agents, contextWith([join(HOME, '.claude'), '/etc/codex'])), ['claude-code', 'codex'])
  assert.deepEqual(detectAgents(agents, contextWith([join(PROJECT, '.replit')])), ['replit'])
})

test('collapseUniversal folds every shared-folder agent into one universal id, listed first', () => {
  assert.deepEqual(collapseUniversal(['claude-code', 'codex', 'cursor', 'universal'], agents), ['universal', 'claude-code'])
  assert.deepEqual(collapseUniversal(['claude-code', 'augment'], agents), ['claude-code', 'augment'])
  assert.deepEqual(collapseUniversal([], agents), [])
})

test('agentsHolding counts only agents with a folder of their own', () => {
  const both = contextWith([join(PROJECT, '.claude', 'skills', 'bmad'), join(PROJECT, '.agents', 'skills', 'bmad')])
  assert.deepEqual(agentsHolding(agents, 'bmad', both), ['claude-code'])
  assert.deepEqual(agentsHolding(agents, 'bmad', contextWith([join(PROJECT, '.agents', 'skills', 'bmad')])), [])
  assert.equal(sharedFolderHolds('bmad', both), true)
  assert.equal(sharedFolderHolds('bmad', contextWith([])), false)
})

test('parseToolsFlag takes ids and display names, drops repeats and names the unknown ones', () => {
  assert.deepEqual(parseToolsFlag('claude-code,Codex, cursor ,claude-code', agents), ['claude-code', 'codex', 'cursor'])
  assert.deepEqual(parseToolsFlag('augment,claude-code', agents), ['augment', 'claude-code'])
  assert.throws(() => parseToolsFlag('claude-code,nope,also-nope', agents), (error) => error instanceof AgentsError && error.message === 'nope, also-nope')
  assert.throws(() => parseToolsFlag(' , ', agents), AgentsError)
})
