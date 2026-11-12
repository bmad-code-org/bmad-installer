import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  problemLines,
  renderFailures,
  renderMigrations,
  renderStatus,
  renderSummary,
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
  reportFailure: 'Failed: {skill} ({error})',
  migrationsAvailable: 'Migrations are available.',
  migrationLine: '{title} - {module} {from} to {to}',
  summaryTitle: 'Installed',
  summaryTitleProblems: 'Installed, with problems',
  summaryProject: 'Project {directory}',
  summaryModules: 'Modules {modules}',
  summaryModuleGroup: '{names} ({version})',
  summaryAgents: 'Agents {agents}',
  summaryNextSetup: 'Next: bmad setup',
  summaryNextCurrent: 'Next: ask bmad',
  summaryNextOther: 'Next: {next}',
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
  assert.ok(lines[5].includes('bmad-agent-pm'))
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

test('renderSummary groups modules by version, drops the brand prefix and picks the next step', () => {
  /** @type {ModuleDefinition[]} */
  const modules = [
    { code: 'core-tools', name: 'BMad Core Tools', description: 'c', source: 'a/b', record: 'bmod-core-tools' },
    { code: 'method', name: 'BMad Method', description: 'm', source: 'a/b', record: 'bmod-method' },
  ]
  const report = fixture('status-fresh.json')
  const summary = renderSummary(report, { messages, modules, directory: '/tmp/demo', agents: ['Claude Code', 'Cursor'], problems: false })
  assert.equal(summary.title, 'Installed')
  assert.equal(summary.body, 'Project /tmp/demo\nModules Core Tools, Method (6.13.0-next)\nAgents Claude Code, Cursor\n\nNext: bmad setup')

  report.modules[1].version = '7.0.0'
  report.current = true
  const later = renderSummary(report, { messages, modules, directory: '/tmp/demo', problems: true })
  assert.equal(later.title, 'Installed, with problems')
  assert.equal(later.body, 'Project /tmp/demo\nModules Core Tools (6.13.0-next); Method (7.0.0)\n\nNext: ask bmad')

  report.current = false
  report.next = 'npx skills update'
  assert.ok(renderSummary(report, { messages, modules, directory: '/d', problems: false }).body.endsWith('Next: npx skills update'))
})

test('problemLines lists failures first and is empty for a clean report', () => {
  assert.deepEqual(problemLines(fixture('status-fresh.json'), [], messages), [])
  const report = fixture('status-fresh.json')
  report.problems = [{ kind: 'duplicate', message: 'two copies of bmad' }]
  assert.deepEqual(problemLines(report, [{ name: 'bmad-x', status: 'failed', error: 'network' }], messages), [
    'Failed: bmad-x (network)',
    'Problem: two copies of bmad',
  ])
})

test('versionMajor reads the leading major version', () => {
  assert.equal(versionMajor('6.13.0-next'), '6')
  assert.equal(versionMajor('7.0.0'), '7')
  assert.equal(versionMajor('6'), '6')
  assert.equal(versionMajor('v6.1.0'), '6')
  assert.equal(versionMajor(''), null)
  assert.equal(versionMajor('unknown'), null)
})
