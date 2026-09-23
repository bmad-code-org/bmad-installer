import { message } from './messages.js'

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
        name: moduleName(modules, module.module),
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

  if (report.pending_questions.length > 0) {
    lines.push(message(messages, 'reportPendingQuestions', { count: report.pending_questions.length }))
  }

  for (const problem of report.problems) {
    lines.push(message(messages, 'reportProblem', { message: problem.message }))
  }

  for (const leftover of report.legacy_leftovers) {
    lines.push(message(messages, 'reportLegacy', { path: leftover }))
  }

  if (failures.length > 0) lines.push(renderFailures(failures, messages))

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
 * @param {ModuleDefinition[]} modules
 * @returns {string}
 */
export function renderModuleMessages(modules) {
  return modules
    .flatMap((module) => (module.message ? [module.message.trim()] : []))
    .join('\n\n')
}

/**
 * @param {Messages} messages
 * @param {{ directory: string }} values
 * @returns {string}
 */
export function renderClosing(messages, values) {
  return message(messages, 'closing', { directory: values.directory })
}

/**
 * @param {string} version
 * @returns {string | null}
 */
export function versionMajor(version) {
  const match = /^v?(\d+)(?=[.\-+]|$)/.exec(version.trim())
  return match ? match[1] : null
}

/**
 * @param {ModuleDefinition[]} modules
 * @param {string} code
 * @returns {string}
 */
function moduleName(modules, code) {
  return modules.find((module) => module.code === code)?.name ?? code
}
