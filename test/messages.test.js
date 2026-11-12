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
  deprecatedModule: { module: 'BMad Method', reason: 'Replaced by another module.' },
  agentsPrompt: {},
  agentsPlaceholder: {},
  agentFoundLabel: { name: 'Claude Code' },
  unknownTools: { ids: 'nope' },
  firstInstallNotInProject: { directory: '/tmp/project' },
  repeatInstall: { command: 'npx bmad-method install -m method -t claude-code -y' },
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
  reportFailure: { skill: 'bmad-prd', error: 'No matching skill found in source' },
  summaryTitle: {},
  summaryTitleProblems: {},
  summaryTitleUpdated: {},
  summaryTitleUpdatedProblems: {},
  summaryProject: { directory: '/tmp/project' },
  summaryModules: { modules: 'Core Tools, Method (6.13.0-next)' },
  summaryModuleGroup: { names: 'Core Tools, Method', version: '6.13.0-next' },
  summaryAgents: { agents: 'Claude Code, Cursor' },
  summaryNextSetup: {},
  summaryNextCurrent: {},
  summaryNextOther: { next: 'npx skills update' },
  universalAgentName: {},
  updateLater: {},
  thanks: {},
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

test('the ending names setup, the update command and every link once', () => {
  const next = message(loaded, 'summaryNextSetup')
  assert.ok(next.includes('bmad setup'))
  assert.ok(message(loaded, 'updateLater').includes('npx bmad-method update'))
  const thanks = message(loaded, 'thanks')
  for (const link of [
    'https://blog.bmadcode.com',
    'https://github.com/bmad-code-org/BMAD-METHOD',
    'https://discord.gg/gk8jAdXWmj',
    'https://www.youtube.com/@BMadCode',
    'https://buymeacoffee.com/bmad',
    'https://bmadcode.com/#contact',
  ]) {
    assert.ok(thanks.includes(link), `thanks is missing: ${link}`)
    assert.equal(message(loaded, 'intro').includes(link), false, `intro repeats ${link}`)
  }
})

test('the prose blocks fit the clack note box without rewrapping', () => {
  const blocks = [
    'intro', 'updateAvailable', 'nodeTooOld', 'nodeBelowSkillsFloor', 'uvMissing', 'wslWindowsNode',
    'needsTerminal', 'insideAgent', 'legacyManifest', 'firstInstallNotInProject', 'unknownTools', 'repeatInstall',
    'nothingInstalled', 'nothingToUpdate', 'cancelled', 'summaryNextSetup', 'summaryNextCurrent', 'thanks', 'droppedUninstall',
  ]
  for (const key of blocks) {
    for (const line of message(loaded, key, keysWithValues[key]).split('\n')) {
      assert.ok(line.length <= NOTE_WIDTH, `${key} line is ${line.length} columns: ${line}`)
    }
  }
})

test('intro is two lines with the docs link', () => {
  const text = message(loaded, 'intro')
  assert.equal(text.split('\n').length, 2)
  assert.ok(text.includes('https://docs.bmad-method.org'))
  assert.ok(text.includes('uv'))
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
