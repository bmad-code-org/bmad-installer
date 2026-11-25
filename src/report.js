import { SETUP_NEXT } from './bmad-scripts.js'
import { message } from './messages.js'
import { moduleName } from './modules.js'

/** @typedef {import('./bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('./bmad-scripts.js').Migration} Migration */
/** @typedef {import('./skills-cli.js').AddResult} AddResult */
/** @typedef {import('./modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {Record<string, any>} Messages */

/**
 * @param {StatusReport} report
 * @param {{ failures: AddResult[], messages: Messages, modules?: ModuleDefinition[] }} options
 * @returns {string}
 */
export function renderStatus(report, options) {
  const { failures, messages, modules = [] } = options
  const lines = [message(messages, 'reportTitle')]

  lines.push(
    report.current
      ? message(messages, 'reportCurrent')
      : message(messages, 'reportNotCurrent', { next: report.next ?? '' }),
  )

  for (const module of report.modules) {
    lines.push(
      message(messages, 'reportModule', {
        name: moduleName(modules, module.module) ?? module.module,
        version: module.version,
        count: module.skills.length,
      }),
    )
    if (module.absent_skills.length > 0) {
      lines.push(
        message(messages, 'reportAlsoAvailable', {
          skills: module.absent_skills.join(', '),
          code: module.module,
        }),
      )
    }
  }

  if (report.pending_questions.length > 0) {
    lines.push(message(messages, 'reportPendingQuestions', { count: report.pending_questions.length }))
  }
  lines.push(...problemLines(report, failures, messages))

  return lines.join('\n')
}

/**
 * @param {AddResult[]} failures
 * @param {Messages} messages
 * @returns {string}
 */
export function renderFailures(failures, messages) {
  return failures
    .map((failure) => message(messages, 'reportFailure', {
      skill: failure.name ?? '',
      error: failure.error ?? failure.reason ?? '',
    }))
    .join('\n')
}

/**
 * @param {Migration[]} migrations
 * @param {Messages} messages
 * @returns {string}
 */
export function renderMigrations(migrations, messages) {
  if (migrations.length === 0) return ''
  const lines = [message(messages, 'migrationsAvailable')]
  for (const migration of migrations) {
    lines.push(
      message(messages, 'migrationLine', {
        title: migration.title,
        module: migration.module,
        from: migration.from,
        to: migration.to,
      }),
    )
  }
  return lines.join('\n')
}

/**
 * What failed or is still missing, one line each; empty when nothing is wrong.
 * @param {StatusReport} report
 * @param {AddResult[]} failures
 * @param {Messages} messages
 * @returns {string[]}
 */
export function problemLines(report, failures, messages) {
  const lines = []
  if (failures.length > 0) lines.push(renderFailures(failures, messages))
  for (const record of report.missing_module_records) {
    lines.push(message(messages, 'reportMissingRecord', { install: record.install ?? '' }))
  }
  for (const unmet of [...report.unmet_requirements, ...report.unmet_recommendations]) {
    lines.push(message(messages, 'reportUnmet', {
      skill: unmet.skill,
      requires: unmet.requires,
      minimum: unmet.minimum ?? '',
      state: unmet.state,
      install: unmet.install ?? '',
    }))
  }
  for (const problem of report.problems) {
    lines.push(message(messages, 'reportProblem', { message: problem.message }))
  }
  return lines
}

/**
 * The closing summary of an install or update: where, which modules, which agents, what next.
 * @param {StatusReport} report
 * @param {{ messages: Messages, modules: ModuleDefinition[], directory: string, agents?: string[], problems: boolean, updated?: boolean }} options
 * @returns {{ title: string, body: string }}
 */
export function renderSummary(report, options) {
  const { messages, modules, directory, agents, problems, updated } = options
  /** @type {Map<string, string[]>} */
  const byVersion = new Map()
  for (const entry of report.modules) {
    // The summary sits under "BMad is installed", so the brand prefix would only push the line past the box width.
    const name = (moduleName(modules, entry.module) ?? entry.module).replace(/^BMad /, '')
    byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), name])
  }
  const installed = [...byVersion]
    .map(([version, names]) => message(messages, 'summaryModuleGroup', { names: names.join(', '), version }))
    .join('; ')
  const lines = [
    message(messages, 'summaryProject', { directory }),
    message(messages, 'summaryModules', { modules: installed }),
  ]
  if (agents) lines.push(message(messages, 'summaryAgents', { agents: agents.join(', ') }))
  lines.push('')
  if (report.current) lines.push(message(messages, 'summaryNextCurrent'))
  else if (report.next === SETUP_NEXT) lines.push(message(messages, 'summaryNextSetup'))
  else lines.push(message(messages, 'summaryNextOther', { next: report.next ?? '' }))
  const title = updated ? (problems ? 'summaryTitleUpdatedProblems' : 'summaryTitleUpdated') : (problems ? 'summaryTitleProblems' : 'summaryTitle')
  return { title: message(messages, title), body: lines.join('\n') }
}

/**
 * A module's name with the version it is installed at.
 * @param {Messages} messages
 * @param {string} name
 * @param {string} [version]
 * @returns {string}
 */
export function installedLabel(messages, name, version) {
  const suffix = version
    ? message(messages, 'installedSuffix', { version })
    : message(messages, 'installedSuffixNoVersion')
  return `${name} ${suffix}`
}

