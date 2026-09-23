import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMessages, message, render, MessagesError } from '../src/messages.js'

const messagesPath = fileURLToPath(new URL('../messages.yaml', import.meta.url))

// clack's note() rewraps at the terminal width minus the box chrome: 74 columns at the default 80.
const NOTE_WIDTH = 74

/** @type {Record<string, Record<string, string | number>>} */
const keysWithValues = {
  intro: {},
  updateAvailable: { current: '6.13.0-next.0', latest: '6.13.0-next.1', tag: 'next' },
  nodeTooOld: { version: '20.11.0' },
  nodeBelowSkillsFloor: { version: '22.13.0' },
  uvMissing: { installCommand: 'curl -LsSf https://astral.sh/uv/install.sh | sh' },
  wslWindowsNode: {},
  needsTerminal: {},
  insideAgent: { agent: 'Claude Code' },
  directoryPrompt: {},
  directoryCreateConfirm: { directory: '/tmp/project' },
  directoryConfirm: { directory: '/tmp/project' },
  legacyManifest: {},
  existingInstallPrompt: {},
  existingInstallModify: {},
  existingInstallUpdate: {},
  foundModules: {},
  installedSuffix: { version: '6.13.0-next' },
  installedSuffixNoVersion: {},
  modulesPrompt: {},
  bundlesPrompt: { module: 'BMad Method' },
  deprecatedModule: { module: 'BMad Method', reason: 'Replaced by another module.' },
  beforeSkillsPicker: {},
  firstInstallNotInProject: { directory: '/tmp/project' },
  bundleSkillUnknown: { module: 'BMad Method', skills: 'bmad-old, bmad-older' },
  installingSpinner: { what: 'BMad Method' },
  statusSpinner: {},
  nothingToUpdate: {},
  nothingInstalled: {},
  updateSpinnerDone: {},
  migrationsAvailable: {},
  migrationLine: { title: 'Move v6 artifacts', module: 'method', from: '6', to: '7' },
  reportTitle: {},
  reportCurrent: {},
  reportNotCurrent: { next: 'bmad setup' },
  reportModule: { name: 'BMad Method', version: '6.13.0-next', count: 22 },
  reportAlsoAvailable: { skills: 'bmad-ux, bmad-spec', code: 'method' },
  reportMissingRecord: { install: 'npx skills add bmad-code-org/BMAD-METHOD -s bmod-method' },
  reportUnmet: {
    skill: 'bmad-prd',
    requires: 'bmad',
    minimum: '6.13.0',
    state: 'outdated',
    install: 'npx skills add bmad-code-org/BMAD-METHOD -s bmad',
  },
  reportPendingQuestions: { count: 3 },
  reportProblem: { message: 'Two records claim the same module.' },
  reportLegacy: { path: '_bmad/_config/manifest.yaml' },
  reportFailure: { skill: 'bmad-prd', error: 'No matching skill found in source' },
  closing: { directory: '/tmp/project' },
  cancelled: {},
  droppedUninstall: {},
}

const droppedFlagNames = [
  'custom-source',
  'set',
  'list-options',
  'user-name',
  'communication-language',
  'document-output-language',
  'output-folder',
  'channel',
  'all-stable',
  'all-next',
  'next',
  'pin',
  'shims',
  'no-shims',
  'list-tools',
]

const uvPlatforms = ['darwin', 'linux', 'win32']

const loaded = await loadMessages(messagesPath)

test('every documented key renders with no placeholder left', () => {
  for (const [key, values] of Object.entries(keysWithValues)) {
    const text = message(loaded, key, values)
    assert.ok(text.length > 0, `${key} is empty`)
    assert.ok(!/\{\w+\}/.test(text), `${key} left a placeholder: ${text}`)
  }
})

test('uvInstall has a command for every platform', () => {
  for (const platform of uvPlatforms) {
    const command = message(loaded, `uvInstall.${platform}`)
    assert.ok(command.includes('astral.sh/uv'), `${platform} command is wrong: ${command}`)
  }
})

test('droppedFlags has one line for every dropped flag', () => {
  const dropped = loaded.droppedFlags
  assert.deepEqual(Object.keys(dropped).sort(), [...droppedFlagNames].sort())
  for (const flag of droppedFlagNames) {
    const line = message(loaded, `droppedFlags.${flag}`)
    assert.ok(!line.includes('\n'), `${flag} is more than one line`)
    assert.ok(!/\{\w+\}/.test(line), `${flag} left a placeholder`)
    assert.ok(line.includes(`--${flag}`), `${flag} does not name the flag`)
  }
})

test('closing names every route the user needs', () => {
  const text = message(loaded, 'closing', { directory: '/tmp/project' })
  for (const needle of ['bmad setup', 'npx bmad-method update', 'npx skills update', 'npx skills remove']) {
    assert.ok(text.includes(needle), `closing is missing: ${needle}`)
  }
  assert.ok(text.includes('/tmp/project'))
  const index = text.indexOf('bmad setup')
  assert.ok(index < text.indexOf('npx bmad-method update'))
  assert.ok(text.indexOf('npx skills update') < text.indexOf('npx skills remove'))
})

test('the prose blocks fit the clack note box without rewrapping', () => {
  const blocks = [
    'intro', 'updateAvailable', 'nodeTooOld', 'nodeBelowSkillsFloor', 'uvMissing', 'wslWindowsNode',
    'needsTerminal', 'insideAgent', 'legacyManifest', 'beforeSkillsPicker', 'firstInstallNotInProject',
    'nothingInstalled', 'nothingToUpdate', 'cancelled', 'closing', 'droppedUninstall',
  ]
  for (const key of blocks) {
    for (const line of message(loaded, key, keysWithValues[key]).split('\n')) {
      assert.ok(line.length <= NOTE_WIDTH, `${key} line is ${line.length} columns: ${line}`)
    }
  }
})

test('closing reads in a terminal', () => {
  const lines = message(loaded, 'closing', { directory: '/tmp/project' }).split('\n')
  assert.ok(lines.some((line) => line === ''), 'closing has no blank line between groups')
})

test('intro is short and carries the links', () => {
  const text = message(loaded, 'intro')
  assert.ok(text.split('\n').length < 20)
  for (const link of [
    'https://docs.bmad-method.org',
    'https://github.com/bmad-code-org/BMAD-METHOD',
    'https://discord.gg/gk8jAdXWmj',
    'https://www.youtube.com/@BMadCode',
    'https://x.com/BMadCode',
    'https://buymeacoffee.com/bmad',
    'contact@bmadcode.com',
  ]) {
    assert.ok(text.includes(link), `intro is missing: ${link}`)
  }
})

test('render fills placeholders and throws when a value is missing', () => {
  assert.equal(render('hello {name}', { name: 'BMad' }), 'hello BMad')
  assert.equal(render('count {n}', { n: 4 }), 'count 4')
  assert.equal(render('no placeholders'), 'no placeholders')
  assert.throws(() => render('hello {name}'), MessagesError)
  assert.throws(() => render('hello {name}', { other: 'x' }), MessagesError)
})

test('message throws on an unknown key', () => {
  assert.throws(() => message(loaded, 'notAKey'), MessagesError)
  assert.throws(() => message(loaded, 'uvInstall'), MessagesError)
  assert.throws(() => message(loaded, 'droppedFlags.not-a-flag'), MessagesError)
})

test('loadMessages rejects a missing file and a file that is not a mapping', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bmad-messages-'))
  const sequence = join(dir, 'sequence.yaml')
  await writeFile(sequence, '- one\n- two\n')

  await assert.rejects(() => loadMessages(join(dir, 'missing.yaml')), MessagesError)
  await assert.rejects(() => loadMessages(sequence), MessagesError)

  await rm(dir, { recursive: true, force: true })
})
