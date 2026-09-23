import { dirname, join } from 'node:path'

/** @typedef {import('./run.js').Runner} Runner */

/** @typedef {{ state: 'current' | 'newer-available' | 'ahead' | 'differing-unordered', source: string, source_version: string }} ModuleUpdateChecked */
/** @typedef {{ state: 'could-not-check', source: string, reason: string }} ModuleUpdateUnchecked */
/** @typedef {{ state: 'plugin-managed', plugin: string, instruction: string }} ModuleUpdatePluginManaged */
/** @typedef {ModuleUpdateChecked | ModuleUpdateUnchecked | ModuleUpdatePluginManaged} ModuleUpdate */

/** @typedef {{ module: string, folder: string, version: string, update_source: string, skills: string[], absent_skills: string[], scripts: string, update: ModuleUpdate }} ModuleStatus */
/** @typedef {{ skill: string, bmod: string, source: string, channel: string, install: string | null }} MissingRecord */
/** @typedef {{ skill: string, module: string | null, requires: string, minimum: string, installed: string, state: 'missing' | 'outdated' | 'unknown-version' | 'unorderable', source: string, channel: string, install: string | null }} UnmetEntry */
/** @typedef {{ module: string, key: string, prompt: string, default: unknown, scope: string }} PendingQuestion */
/** @typedef {{ kind: string, message: string } & Record<string, unknown>} Problem */
/** @typedef {{ module: string, path: string, file: string, from: string, to: string, title: string }} Migration */

/**
 * @typedef {{
 *   mode: string,
 *   module: string | null,
 *   bmad_exists: boolean,
 *   bmad: { skill: string, version: string | null, module: string | null },
 *   shared_scripts: string,
 *   custom_gitignore: string,
 *   modules: ModuleStatus[],
 *   missing_module_records: MissingRecord[],
 *   pending_questions: PendingQuestion[],
 *   unmet_requirements: UnmetEntry[],
 *   unmet_recommendations: UnmetEntry[],
 *   problems: Problem[],
 *   legacy_leftovers: string[],
 *   current: boolean,
 *   next: string | null
 * }} StatusReport
 */

export class BmadScriptsError extends Error {
  /**
   * @param {string} message
   * @param {string} [stderr]
   */
  constructor(message, stderr = '') {
    super(message)
    this.name = 'BmadScriptsError'
    this.stderr = stderr
  }
}

/**
 * @param {string} bmadSkillDir
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function setupStatusArgv(bmadSkillDir, projectRoot) {
  return [
    'uv',
    'run',
    '--no-cache',
    join(bmadSkillDir, 'scripts', 'setup.py'),
    '--project-root',
    projectRoot,
    '--skill',
    bmadSkillDir,
    '--status',
  ]
}

/**
 * @param {string} bmadSkillDir
 * @returns {string[]}
 */
export function knowledgeArgv(bmadSkillDir) {
  return [
    'uv',
    'run',
    '--no-cache',
    join(bmadSkillDir, 'scripts', 'knowledge.py'),
    '--root',
    dirname(bmadSkillDir),
  ]
}

/**
 * @param {string} stdout
 * @returns {StatusReport}
 */
export function parseStatus(stdout) {
  const parsed = parseJson(stdout, 'setup.py --status')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BmadScriptsError('setup.py --status did not return an object')
  }
  return /** @type {StatusReport} */ (parsed)
}

/**
 * @param {string} stdout
 * @returns {Migration[]}
 */
export function parseMigrations(stdout) {
  const parsed = parseJson(stdout, 'knowledge.py')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BmadScriptsError('knowledge.py did not return an object')
  }
  const migrations = /** @type {{ migrations?: unknown }} */ (parsed).migrations
  return Array.isArray(migrations) ? /** @type {Migration[]} */ (migrations) : []
}

/**
 * @param {{ runner: Runner }} deps
 */
export function createBmadScripts(deps) {
  const { runner } = deps

  return {
    /**
     * @param {string} bmadSkillDir
     * @param {string} projectRoot
     * @returns {Promise<StatusReport>}
     */
    async status(bmadSkillDir, projectRoot) {
      const result = await runner({ argv: setupStatusArgv(bmadSkillDir, projectRoot) })
      const stderr = result.error ? `${result.stderr}${result.error}` : result.stderr
      if (result.code !== 0) {
        throw new BmadScriptsError(`setup.py --status exited with ${result.code}`, stderr)
      }
      try {
        return parseStatus(result.stdout)
      } catch (err) {
        throw new BmadScriptsError(errorMessage(err), stderr)
      }
    },

    /**
     * @param {string} bmadSkillDir
     * @returns {Promise<Migration[]>}
     */
    async migrations(bmadSkillDir) {
      const result = await runner({ argv: knowledgeArgv(bmadSkillDir) })
      if (result.code !== 0) return []
      try {
        return parseMigrations(result.stdout)
      } catch {
        return []
      }
    },
  }
}

/**
 * @param {string} stdout
 * @param {string} what
 * @returns {unknown}
 */
function parseJson(stdout, what) {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new BmadScriptsError(`${what} did not return JSON`)
  }
}

/** @param {unknown} err */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}
