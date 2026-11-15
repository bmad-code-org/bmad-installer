import { UNIVERSAL_AGENT } from '../agents.js'
import { message } from '../messages.js'
import { nodeFailureHint } from '../preflight.js'
import { problemLines, renderMigrations, renderSummary } from '../report.js'
import { selectMigrations, versionsByCode } from './install-plan.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */

/**
 * Ends an install or update: the migrations for a major version this run crossed, what went
 * wrong if anything, the summary, the commands people reuse, and the links. `before` holds the
 * module versions from before the run.
 * @param {CommandDeps} deps
 * @param {{ report: StatusReport, bmadSkillDir: string, before: Record<string, string>, failures: AddResult[], directory: string, agents?: string[], repeat?: string, updated?: boolean }} run
 */
export async function endRun(deps, run) {
  const { bmadScripts, messages, modules, prompts } = deps
  const migrations = selectMigrations(await bmadScripts.migrations(run.bmadSkillDir), {
    before: run.before,
    after: versionsByCode(run.report),
  })
  if (migrations.length > 0) prompts.showNote(renderMigrations(migrations, messages))

  const problems = problemLines(run.report, run.failures, messages)
  const hint = run.failures.length > 0 ? nodeFailureHint(messages, deps.node) : null
  if (hint) problems.push(hint)
  if (problems.length > 0) prompts.warn(problems.join('\n'))

  const agents = run.agents?.map((id) => (id === UNIVERSAL_AGENT
    ? message(messages, 'universalAgentName')
    : deps.agents.find((agent) => agent.id === id)?.name ?? id))
  const summary = renderSummary(run.report, { messages, modules, directory: run.directory, agents, problems: problems.length > 0, updated: run.updated })
  prompts.showNote(summary.body, summary.title)

  if (!run.updated) {
    const commands = [message(messages, 'updateLater')]
    if (run.repeat) commands.push(message(messages, 'repeatInstall', { command: run.repeat }))
    prompts.plain(commands.join('\n'))
  }
  prompts.plain(message(messages, 'thanks'))
  prompts.finish('')
}
