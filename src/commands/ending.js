import { UNIVERSAL_AGENT } from '../agents.js'
import { message } from '../messages.js'
import { problemLines, renderSummary } from '../report.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */
/** @typedef {import('./install.js').CommandDeps} CommandDeps */

/**
 * Ends an install or update: what went wrong if anything, the summary, the commands people reuse,
 * and the links.
 * @param {CommandDeps} deps
 * @param {{ report: StatusReport, failures: AddResult[], directory: string, agents?: string[], repeat?: string, updated?: boolean }} run
 */
export function showEnding(deps, run) {
  const { messages, modules, prompts } = deps
  const problems = problemLines(run.report, run.failures, messages)
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
