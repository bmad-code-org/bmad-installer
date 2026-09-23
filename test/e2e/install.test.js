import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../../src/run.js'
import { listArgv, parseListResults } from '../../src/skills-cli.js'

const source = process.env.BMAD_INSTALLER_E2E_SOURCE
const bin = fileURLToPath(new URL('../../bin/bmad-method.js', import.meta.url))
const TIMEOUT_MS = 600_000
const EXPECTED = ['bmad', 'bmod-core-tools', 'bmod-method', 'bmad-prd']

test('a real headless install lands the records, the members and the closing message', {
  skip: source ? false : 'set BMAD_INSTALLER_E2E_SOURCE to a local BMAD-METHOD checkout',
  timeout: TIMEOUT_MS,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bmad-e2e-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const runner = createRunner({ debug: Boolean(process.env.BMAD_INSTALLER_E2E_DEBUG) })
  const env = { ...process.env, BMAD_INSTALLER_SOURCE_OVERRIDE: source }

  const install = await runner({
    argv: [
      process.execPath, bin, 'install',
      '--yes',
      '--tools', 'claude-code',
      '--modules', 'method:planning',
      '--directory', directory,
      '--no-telemetry',
    ],
    cwd: directory,
    env,
    timeoutMs: TIMEOUT_MS,
  })

  assert.equal(install.code, 0, `${install.stdout}\n${install.stderr}`)
  assert.ok(install.stdout.includes('bmad setup'), install.stdout)

  const list = await runner({ argv: listArgv(), cwd: directory, env, timeoutMs: TIMEOUT_MS })
  const names = parseListResults(list.stdout).map((skill) => skill.name)
  for (const name of EXPECTED) assert.ok(names.includes(name), `${name} is missing from ${names.join(', ')}`)
})
