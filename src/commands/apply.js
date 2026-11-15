import { inspectInstall } from '../installed.js'
import { message } from '../messages.js'

/** @typedef {import('../bmad-scripts.js').StatusReport} StatusReport */
/** @typedef {import('../skills-cli.js').AddResult} AddResult */
/** @typedef {import('./deps.js').CommandDeps} CommandDeps */
/** @typedef {import('./install-plan.js').InstallCall} InstallCall */

/**
 * Runs one `skills add` per call under a single spinner, then reads the install back. `plan` runs
 * inside the spinner, so a plan that has to read the install first shows no second spinner.
 * `report` is null only when the `bmad` skill is nowhere in the project afterwards.
 * @param {CommandDeps} deps
 * @param {{ directory: string, agents: string[], spinner: 'installingSpinner' | 'updatingSpinner', plan: () => Promise<InstallCall[]> | InstallCall[], bmadSkillDir?: string | null }} run
 * @returns {Promise<{ failures: AddResult[], bmadSkillDir: string | null, report: StatusReport | null }>}
 */
export async function applyCalls(deps, run) {
  const { bmadScripts, messages, prompts, skillsCli } = deps
  const { directory, agents } = run
  /** @type {AddResult[]} */
  const failures = []
  const progress = prompts.startSpinner(message(messages, 'statusSpinner'))
  try {
    for (const call of await run.plan()) {
      progress.update(message(messages, run.spinner, { what: call.label }))
      const results = await skillsCli.add({ source: call.source, skills: call.skills, agents, cwd: directory })
      failures.push(...results.filter((entry) => entry.status !== 'installed'))
    }
    const bmadSkillDir = (await inspectInstall(directory, skillsCli)).bmadSkillDir ?? run.bmadSkillDir ?? null
    if (!bmadSkillDir) return { failures, bmadSkillDir, report: null }
    progress.update(message(messages, 'statusSpinner'))
    return { failures, bmadSkillDir, report: await bmadScripts.status(bmadSkillDir, directory) }
  } finally {
    progress.stop()
  }
}
