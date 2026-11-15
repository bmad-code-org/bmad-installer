import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAgents } from '../../src/agents.js'
import { loadMessages } from '../../src/messages.js'
import { loadModules } from '../../src/modules.js'

/** @typedef {import('../../src/bmad-scripts.js').Migration} Migration */
/** @typedef {import('../../src/bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../../src/cli.js').CliOptions} CliOptions */
/** @typedef {import('../../src/commands/install.js').CommandDeps} CommandDeps */
/** @typedef {import('../../src/run.js').Runner} Runner */
/** @typedef {import('../../src/skills-cli.js').AddResult} AddResult */
/** @typedef {import('../../src/skills-cli.js').ListedSkill} ListedSkill */

export const messages = await loadMessages()
export const modules = await loadModules()
export const agents = await loadAgents()
export const HOME = '/home/user'

/**
 * A file system where only `paths` exist, for agent detection.
 * @param {string[]} [paths]
 * @returns {(project: string) => import('../../src/agents.js').DetectContext}
 */
export function detectWith(paths = []) {
  const existing = new Set(paths)
  return (project) => ({ home: HOME, project, exists: (path) => existing.has(path) })
}
export const RECORDS = ['bmad', 'bmod-core-tools', 'bmod-method']

const fresh = JSON.parse(await readFile(new URL('../fixtures/status-fresh.json', import.meta.url), 'utf8'))

/** @param {Partial<StatusReport>} [patch] @returns {StatusReport} */
export function statusOf(patch = {}) {
  return { ...structuredClone(fresh), ...patch }
}

/** @param {string} name @returns {ListedSkill} */
export function listed(name) {
  return { name, path: `/project/.agents/skills/${name}`, scope: 'project', agents: ['Claude Code'], source: 'a/b' }
}

/** @param {Record<string, any>} [answers] */
export function fakePrompts(answers = {}) {
  /** @type {Record<string, string[]>} */
  const said = { notes: [], says: [], warns: [], fails: [], finish: [], plain: [] }
  /** @type {string[]} */
  const asked = []
  /** @type {{ initial: string[] }[]} */
  const pickers = []
  const prompts = /** @type {any} */ ({
    showIntro: () => asked.push('intro'),
    showNote: (/** @type {string} */ t, /** @type {string | undefined} */ title) => said.notes.push(title ? `${title}\n${t}` : t),
    say: (/** @type {string} */ t) => said.says.push(t),
    plain: (/** @type {string} */ t) => said.plain.push(t),
    warn: (/** @type {string} */ t) => said.warns.push(t),
    fail: (/** @type {string} */ t) => said.fails.push(t),
    finish: (/** @type {string} */ t) => said.finish.push(t),
    startSpinner: () => ({ stop: () => {}, update: () => {} }),
    askDirectory: async (/** @type {any} */ _m, /** @type {string} */ d) => (asked.push('directory'), d),
    confirm: async () => (asked.push('confirm'), answers.confirm ?? true),
    chooseModules: async () => (asked.push('modules'), answers.modules ?? ['method']),
    chooseAgents: async (/** @type {any} */ _m, /** @type {any} */ _a, /** @type {{ initial: string[] }} */ picker) => {
      asked.push('agents')
      pickers.push(picker)
      return answers.agents ?? (picker.initial.length > 0 ? picker.initial : ['claude-code'])
    },
    chooseExistingAction: async () => (asked.push('existing'), answers.existing ?? 'modify'),
  })
  return { prompts, said, asked, pickers }
}

/**
 * @param {{
 *   lists: ListedSkill[][],
 *   add?: (request: any) => AddResult[],
 *   updateCode?: number
 * }} script
 */
export function fakeSkillsCli(script) {
  /** @type {any[]} */
  const requests = []
  let listIndex = 0
  const cli = /** @type {any} */ ({
    async add(/** @type {any} */ request) {
      requests.push({ kind: 'add', ...request })
      if (script.add) return script.add(request)
      return request.skills.map((/** @type {string} */ name) => ({ name, status: 'installed' }))
    },
    async update(/** @type {any} */ options) {
      requests.push({ kind: 'update', ...options })
      return { code: script.updateCode ?? 0 }
    },
    async list(/** @type {any} */ options) {
      requests.push({ kind: 'list', ...options })
      const result = script.lists[Math.min(listIndex, script.lists.length - 1)]
      listIndex += 1
      return result
    },
  })
  return { cli, requests }
}

/** @param {{ statuses: StatusReport[], migrations?: Migration[] }} script */
export function fakeBmadScripts(script) {
  let index = 0
  /** @type {string[]} */
  const seen = []
  const scripts = /** @type {any} */ ({
    async status(/** @type {string} */ bmadSkillDir) {
      seen.push(bmadSkillDir)
      const report = script.statuses[Math.min(index, script.statuses.length - 1)]
      index += 1
      return report
    },
    async migrations() {
      return script.migrations ?? []
    },
  })
  return { scripts, seen }
}

/** @param {{ uv?: boolean }} [script] */
export function fakeRunner(script = {}) {
  /** @type {string[][]} */
  const calls = []
  /** @type {Runner} */
  const runner = async (request) => {
    calls.push(request.argv)
    const ok = request.argv[0] === 'uv' && script.uv !== false
    return { code: ok ? 0 : 1, stdout: ok ? 'uv 0.5.31\n' : '', stderr: '', timedOut: false }
  }
  return { runner, calls }
}

/** A throwaway HOME and state folder, so no test reads or writes the real ones. */
function isolatedHome() {
  const home = mkdtempSync(join(tmpdir(), 'bmad-home-'))
  return { HOME: home, XDG_STATE_HOME: join(home, '.state') }
}

/**
 * @param {{ prompts: any, skillsCli: any, bmadScripts: any, cwd?: string, env?: NodeJS.ProcessEnv, runner?: Runner, detect?: ReturnType<typeof detectWith> }} parts
 * @returns {CommandDeps}
 */
export function makeDeps(parts) {
  return /** @type {CommandDeps} */ ({
    runner: parts.runner ?? fakeRunner().runner,
    skillsCli: parts.skillsCli,
    bmadScripts: parts.bmadScripts,
    messages,
    modules,
    agents,
    detect: parts.detect ?? detectWith(),
    prompts: parts.prompts,
    env: { ...isolatedHome(), ...parts.env },
    cwd: parts.cwd ?? '/project',
    version: '6.13.0-next.0',
    node: '24.0.0',
    terminal: () => true,
    agent: async () => null,
  })
}

/** @param {Partial<CliOptions>} [patch] @returns {CliOptions} */
export function options(patch = {}) {
  return { command: 'install', yes: false, telemetry: true, copy: false, debug: false, ...patch }
}

/** @param {any[]} requests @param {string} [kind] */
export function only(requests, kind = 'add') {
  return requests.filter((request) => request.kind === kind)
}

/** @param {import('node:test').TestContext} t */
export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-install-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
