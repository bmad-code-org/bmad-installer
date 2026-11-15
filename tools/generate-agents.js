// Writes agents.json from the agent table in the installed skills CLI bundle. Run it after every
// `skills` version bump: `node tools/generate-agents.js`. test/agents.test.js fails until you do.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/** @typedef {import('../src/agents.js').Agent} AgentEntry */
/** @typedef {import('../src/agents.js').AgentsFile} AgentsFile */

const HOME = '/__home__'
const CWD = '/__project__'
const TABLE_START = 'const home = homedir();'
const AGENTS_START = 'const agents = {'
// Eve is the CLI's own subagent host; its pickers leave it out and so does this list.
const SKIPPED = new Set(['eve'])

export const AGENTS_FILE = fileURLToPath(new URL('../agents.json', import.meta.url))

function skillsPackageDir() {
  return dirname(createRequire(import.meta.url).resolve('skills/package.json'))
}

/** @param {string} path */
function portable(path) {
  if (path === HOME || path.startsWith(`${HOME}/`)) return `~${path.slice(HOME.length)}`
  if (path.startsWith(`${CWD}/`)) return `./${path.slice(CWD.length + 1)}`
  return path
}

/**
 * Runs the bundle's agent table with a fake file system that answers "no" to every path, so each
 * detection checks every path it knows and the list of asked paths is its detection rule. Environment
 * overrides such as CODEX_HOME are left unset, so the defaults are what gets recorded.
 * @param {string} bundle
 * @returns {Promise<AgentEntry[]>}
 */
export async function agentsFromBundle(bundle) {
  const start = bundle.indexOf(TABLE_START)
  const tableAt = bundle.indexOf(AGENTS_START, start)
  const end = bundle.indexOf('\n};\n', tableAt)
  if (start === -1 || tableAt === -1 || end === -1) throw new Error('agent table not found in the skills CLI bundle')

  /** @type {string[]} */
  let asked = []
  const context = vm.createContext({
    homedir: () => HOME,
    join: posix.join,
    existsSync: (/** @type {string} */ path) => (asked.push(path), false),
    readFileSync: () => {
      throw new Error('not readable')
    },
    xdgConfig: undefined,
    process: { env: {}, cwd: () => CWD, platform: 'linux' },
  })
  const table = vm.runInContext(`${bundle.slice(start, end + 3)}\nagents`, context)

  /** @type {AgentEntry[]} */
  const entries = []
  for (const [id, config] of Object.entries(table)) {
    if (SKIPPED.has(id)) continue
    asked = []
    await config.detectInstalled()
    entries.push({ id, name: config.displayName, skillsDir: config.skillsDir, detect: [...new Set(asked.map(portable))] })
  }
  return entries
}

/** @returns {Promise<AgentsFile>} */
export async function generateAgents() {
  const dir = skillsPackageDir()
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  const bundle = await readFile(join(dir, 'dist', 'cli.mjs'), 'utf8')
  return { skillsVersion: pkg.version, agents: await agentsFromBundle(bundle) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = await generateAgents()
  await writeFile(AGENTS_FILE, `${JSON.stringify(file, null, 2)}\n`)
  console.log(`Wrote ${file.agents.length} agents from skills ${file.skillsVersion} to agents.json`)
}
