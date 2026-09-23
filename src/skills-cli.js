import { createRequire } from 'node:module'

/** @typedef {import('./run.js').RunResult} RunResult */
/** @typedef {import('./run.js').Runner} Runner */
/** @typedef {{ name?: string, status: 'installed' | 'failed' | 'skipped', error?: string, reason?: string, path?: string, agents?: string[], mode?: string }} AddResult */
/** @typedef {{ name: string, path: string, scope: 'project' | 'global', agents: string[], source: string | null }} ListedSkill */
/** @typedef {{ source: string, skills: string[], agents?: string[] | null }} AddRequest */

export class SkillsCliError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: number | null, stderr?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message)
    this.name = 'SkillsCliError'
    this.code = details.code ?? null
    this.stderr = details.stderr ?? ''
  }
}

/** @returns {string} */
export function skillsCliBin() {
  return createRequire(import.meta.url).resolve('skills/bin/cli.mjs')
}

/**
 * @param {NodeJS.ProcessEnv} base
 * @param {{ telemetry: boolean }} options
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(base, options) {
  const env = { ...base }
  if (!options.telemetry) env.DO_NOT_TRACK = '1'
  return env
}

/**
 * `-s` and `-a` swallow every following non-dash token, so `--metadata` comes after them.
 * @param {AddRequest} request
 * @param {{ interactive: boolean, copy: boolean, metadata: object }} options
 * @returns {string[]}
 */
export function addArgv(request, options) {
  const argv = [process.execPath, skillsCliBin(), 'add', request.source, '-s', ...request.skills]
  if (Array.isArray(request.agents) && request.agents.length > 0) argv.push('-a', ...request.agents)
  argv.push('--metadata', JSON.stringify(options.metadata))
  if (options.copy) argv.push('--copy')
  if (!options.interactive) argv.push('-y', '--json')
  return argv
}

/** @returns {string[]} */
export function updateArgv() {
  return [process.execPath, skillsCliBin(), 'update', '-p', '-y']
}

/** @returns {string[]} */
export function listArgv() {
  return [process.execPath, skillsCliBin(), 'list', '--json']
}

/**
 * @param {string} stdout
 * @returns {AddResult[]}
 */
export function parseAddResults(stdout) {
  return parseJsonArray(stdout)
}

/**
 * @param {string} stdout
 * @returns {ListedSkill[]}
 */
export function parseListResults(stdout) {
  return parseJsonArray(stdout)
}

/**
 * @param {string} stdout
 * @returns {any[]}
 */
function parseJsonArray(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new SkillsCliError('skills CLI stdout is not JSON')
  }
  if (!Array.isArray(parsed)) throw new SkillsCliError('skills CLI stdout is not a JSON array')
  return parsed
}

/**
 * @param {RunResult} result
 * @returns {string}
 */
function failureReason(result) {
  const lines = result.stderr.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.at(-1) ?? `skills CLI exited with code ${result.code}`
}

/**
 * @param {{ runner: Runner, env: NodeJS.ProcessEnv, telemetry: boolean, copy: boolean, metadata: object }} deps
 */
export function createSkillsCli(deps) {
  const env = childEnv(deps.env, { telemetry: deps.telemetry })
  const { copy, metadata } = deps

  return {
    /** @param {AddRequest & { cwd: string }} request */
    async addInteractive(request) {
      const result = await deps.runner({
        argv: addArgv(request, { interactive: true, copy, metadata }),
        cwd: request.cwd,
        env,
        stdio: 'inherit',
      })
      return { code: result.code }
    },
    /**
     * @param {AddRequest & { cwd: string }} request
     * @returns {Promise<AddResult[]>}
     */
    async add(request) {
      const result = await deps.runner({
        argv: addArgv(request, { interactive: false, copy, metadata }),
        cwd: request.cwd,
        env,
        stdio: 'pipe',
      })
      try {
        return parseAddResults(result.stdout)
      } catch {
        return [{ status: 'failed', error: failureReason(result) }]
      }
    },
    /** @param {{ cwd: string }} options */
    async update(options) {
      const result = await deps.runner({ argv: updateArgv(), cwd: options.cwd, env, stdio: 'inherit' })
      return { code: result.code }
    },
    /**
     * @param {{ cwd: string }} options
     * @returns {Promise<ListedSkill[]>}
     */
    async list(options) {
      const result = await deps.runner({ argv: listArgv(), cwd: options.cwd, env, stdio: 'pipe' })
      if (result.code !== 0 && result.stdout.trim() === '') return []
      return parseListResults(result.stdout)
    },
  }
}
