import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  renderClosing,
  renderFailures,
  renderMigrations,
  renderModuleMessages,
  renderStatus,
  versionMajor,
} from '../src/report.js'

/** @typedef {import('../src/bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../src/modules.js').ModuleDefinition} ModuleDefinition */

const messages = {
  reportTitle: 'BMad status',
  reportCurrent: 'Everything is set up.',
  reportNotCurrent: 'Next step: {next}',
  reportModule: '{name} {version} - {count} skills installed',
  reportAlsoAvailable: 'Also available for {code}: {skills}',
  reportMissingRecord: 'Missing module record. Install it with: {install}',
  reportUnmet: '{skill} needs {requires} {minimum} ({state}): {install}',
  reportPendingQuestions: 'Pending questions: {count}',
  reportProblem: 'Problem: {message}',
  reportLegacy: 'Left over: {path}',
  reportFailure: 'Failed: {skill} ({error})',
  migrationsAvailable: 'Migrations are available.',
  migrationLine: '{title} - {module} {from} to {to}',
  closing: 'Installed in {directory}. Ask your agent for bmad setup.',
}

/** @param {string} name @returns {StatusReport} */
function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

test('renderStatus lists the title, the next step and every module', () => {
  const text = renderStatus(fixture('status-fresh.json'), { failures: [], messages })
  const lines = text.split('\n')

  assert.equal(lines[0], 'BMad status')
  assert.equal(lines[1], 'Next step: bmad setup')
  assert.equal(lines[2], 'core-tools 6.13.0-next - 1 skills installed')
  assert.ok(lines[3].startsWith('Also available for core-tools: bmad-advanced-elicitation,'))
  assert.equal(lines[4], 'method 6.13.0-next - 0 skills installed')
  assert.ok(lines[5].includes('bmad-prd'))
  assert.equal(lines.length, 6)
})

test('renderStatus prefers the module name from modules.yaml', () => {
  /** @type {ModuleDefinition[]} */
  const modules = [
    {
      code: 'method',
      name: 'BMad Method',
      description: 'Plan, spec and build',
      source: 'bmad-code-org/BMAD-METHOD',
      record: 'bmod-method',
    },
  ]
  const text = renderStatus(fixture('status-after-prd.json'), { failures: [], messages, modules })

  assert.ok(text.includes('BMad Method 6.13.0-next - 1 skills installed'))
  assert.ok(text.includes('core-tools 6.13.0-next - 1 skills installed'))
})

test('renderStatus omits the also-available line when nothing is absent', () => {
  const report = fixture('status-fresh.json')
  report.modules[0].absent_skills = []
  report.modules[1].absent_skills = []

  const text = renderStatus(report, { failures: [], messages })

  assert.equal(text.includes('Also available'), false)
})

test('renderStatus reports the current install without a next step', () => {
  const report = fixture('status-fresh.json')
  report.current = true
  report.next = null

  const text = renderStatus(report, { failures: [], messages })

  assert.ok(text.includes('Everything is set up.'))
  assert.equal(text.includes('Next step:'), false)
})

test('renderStatus lists problems, unmet needs, questions, leftovers and failures', () => {
  const report = fixture('status-fresh.json')
  report.missing_module_records = [
    { skill: 'bmad-ux', bmod: 'bmod-method', source: 'github', channel: 'main', install: 'npx skills add x' },
  ]
  report.unmet_requirements = [
    {
      skill: 'bmad-prd',
      module: 'method',
      requires: 'bmad',
      minimum: '6.13.0',
      installed: '6.12.0',
      state: 'outdated',
      source: 'github',
      channel: 'main',
      install: 'npx skills add bmad',
    },
  ]
  report.unmet_recommendations = [
    {
      skill: 'bmad-build',
      module: 'method',
      requires: 'bmad-review',
      minimum: '6.13.0',
      installed: '',
      state: 'missing',
      source: 'github',
      channel: 'main',
      install: null,
    },
  ]
  report.pending_questions = [
    { module: 'method', key: 'user_name', prompt: 'Your name?', default: null, scope: 'project' },
  ]
  report.problems = [{ kind: 'duplicate', message: 'two copies of bmad' }]
  report.legacy_leftovers = ['_bmad/_config/manifest.yaml']

  const text = renderStatus(report, {
    messages,
    failures: [
      { name: 'bmad-spec', status: 'failed', error: 'network' },
      { name: 'bmod-nope', status: 'skipped', reason: 'No matching skill found in source' },
      { status: 'failed', error: 'whole run failed' },
    ],
  })

  assert.ok(text.includes('Missing module record. Install it with: npx skills add x'))
  assert.ok(text.includes('bmad-prd needs bmad 6.13.0 (outdated): npx skills add bmad'))
  assert.ok(text.includes('bmad-build needs bmad-review 6.13.0 (missing): '))
  assert.ok(text.includes('Pending questions: 1'))
  assert.ok(text.includes('Problem: two copies of bmad'))
  assert.ok(text.includes('Left over: _bmad/_config/manifest.yaml'))
  assert.ok(text.includes('Failed: bmad-spec (network)'))
  assert.ok(text.includes('Failed: bmod-nope (No matching skill found in source)'))
  assert.ok(text.includes('Failed:  (whole run failed)'))
})

test('renderFailures names each failed skill and its reason', () => {
  assert.equal(renderFailures([], messages), '')
  assert.deepEqual(
    renderFailures(
      [
        { name: 'bmad-spec', status: 'failed', error: 'Failed to clone repository' },
        { status: 'failed', error: 'Invalid agents: nope' },
      ],
      messages,
    ).split('\n'),
    ['Failed: bmad-spec (Failed to clone repository)', 'Failed:  (Invalid agents: nope)'],
  )
})

test('renderMigrations is empty without migrations and lists them otherwise', () => {
  assert.equal(renderMigrations([], messages), '')

  const text = renderMigrations(
    [
      {
        module: 'method',
        path: 'v6-v7-migration.toml',
        file: '/project/.agents/skills/bmod-method/v6-v7-migration.toml',
        from: '6',
        to: '7',
        title: 'Move v6 artifacts',
      },
    ],
    messages,
  )

  assert.deepEqual(text.split('\n'), [
    'Migrations are available.',
    'Move v6 artifacts - method 6 to 7',
  ])
})

test('renderModuleMessages joins only the modules that carry a message', () => {
  /** @type {ModuleDefinition[]} */
  const modules = [
    { code: 'core-tools', name: 'Core', description: 'c', source: 'a/b', record: 'bmod-core-tools' },
    {
      code: 'method',
      name: 'Method',
      description: 'm',
      source: 'a/b',
      record: 'bmod-method',
      message: 'Ask the bmad skill what to do next.\n',
    },
  ]

  assert.equal(renderModuleMessages(modules), 'Ask the bmad skill what to do next.')
  assert.equal(renderModuleMessages([]), '')
})

test('renderClosing fills in the directory', () => {
  assert.equal(
    renderClosing(messages, { directory: '/tmp/demo' }),
    'Installed in /tmp/demo. Ask your agent for bmad setup.',
  )
})

test('versionMajor reads the leading major version', () => {
  assert.equal(versionMajor('6.13.0-next'), '6')
  assert.equal(versionMajor('7.0.0'), '7')
  assert.equal(versionMajor('6'), '6')
  assert.equal(versionMajor('v6.1.0'), '6')
  assert.equal(versionMajor(''), null)
  assert.equal(versionMajor('unknown'), null)
})
