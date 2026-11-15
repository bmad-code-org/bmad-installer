/** @typedef {import('../modules.js').ModuleDefinition} ModuleDefinition */
/** @typedef {import('../run.js').Runner} Runner */

/**
 * What every command is handed. `terminal`, `agent`, `detect` and `node` stand in for the live
 * TTY, coding-agent, file system and Node version checks in tests.
 * @typedef {{
 *   runner: Runner,
 *   skillsCli: ReturnType<typeof import('../skills-cli.js').createSkillsCli>,
 *   bmadScripts: ReturnType<typeof import('../bmad-scripts.js').createBmadScripts>,
 *   messages: Record<string, any>,
 *   modules: ModuleDefinition[],
 *   agents: import('../agents.js').Agent[],
 *   detect?: (project: string) => import('../agents.js').DetectContext,
 *   prompts: typeof import('../prompts.js'),
 *   env: NodeJS.ProcessEnv,
 *   cwd: string,
 *   version: string,
 *   node?: string,
 *   terminal?: () => boolean,
 *   agent?: () => Promise<string | null>
 * }} CommandDeps
 */

export {}
