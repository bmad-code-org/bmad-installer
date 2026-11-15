import { randomUUID } from 'node:crypto'
import { open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import spawn from 'cross-spawn'

/** @typedef {{ argv: string[], cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} RunRequest */
/** @typedef {{ code: number | null, stdout: string, stderr: string, timedOut: boolean, error?: string }} RunResult */
/** @typedef {(request: RunRequest) => Promise<RunResult>} Runner */
/** @typedef {{ fd: number, read(): Promise<string>, dispose(): Promise<void> }} Capture */

/**
 * A spawned child's stdout pipe is a socket with an 8 KB buffer, and a child that ends with
 * `process.exit()` drops whatever has not drained. Writes to a regular file always land, so
 * captured stdout goes through a temp file instead.
 * @returns {Promise<Capture>}
 */
async function openCapture() {
  const path = join(tmpdir(), `bmad-installer-${randomUUID()}`)
  const handle = await open(path, 'w+')
  return {
    fd: handle.fd,
    async read() {
      try {
        return await readFile(path, 'utf8')
      } catch {
        return ''
      }
    },
    async dispose() {
      await handle.close().catch(() => {})
      await rm(path, { force: true }).catch(() => {})
    },
  }
}

/**
 * @param {RunRequest & { capture: Capture }} request
 * @returns {Promise<RunResult>}
 */
function spawnAndWait(request) {
  const { capture, timeoutMs } = request
  const [command, ...args] = request.argv

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd: request.cwd,
        env: request.env,
        stdio: ['ignore', capture.fd, 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, error: String(err) })
      return
    }

    let stderr = ''
    let timedOut = false
    /** @type {NodeJS.Timeout | undefined} */
    let timer

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => { stderr += chunk })

    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)
    }

    /**
     * @param {number | null} code
     * @param {string} [error]
     */
    const settle = async (code, error) => {
      if (timer) clearTimeout(timer)
      const stdout = await capture.read()
      resolve(error === undefined
        ? { code, stdout, stderr, timedOut }
        : { code, stdout, stderr, timedOut, error })
    }

    child.on('error', (err) => { void settle(null, String(err.message ?? err)) })
    child.on('close', (code) => { void settle(code) })
  })
}

/**
 * @param {{ debug?: boolean, log?: (line: string) => void }} [options]
 * @returns {Runner}
 */
export function createRunner(options = {}) {
  const debug = options.debug ?? false
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`))

  /** @type {Runner} */
  return async function run(request) {
    const { argv, cwd } = request
    if (debug) log(`$ ${cwd ?? process.cwd()}: ${argv.join(' ')}`)

    /** @type {Capture} */
    let capture
    try {
      capture = await openCapture()
    } catch (err) {
      return { code: null, stdout: '', stderr: '', timedOut: false, error: String(err) }
    }

    try {
      const result = await spawnAndWait({ ...request, capture })
      if (debug) {
        log(`exit ${result.code}`)
        if (result.stdout) log(result.stdout)
        if (result.stderr) log(result.stderr)
      }
      return result
    } finally {
      await capture.dispose()
    }
  }
}
