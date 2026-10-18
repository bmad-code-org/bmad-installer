# bmad-installer

`npm test` runs the unit tests, `npm run check` runs tsc, `npm run e2e` runs the end-to-end tests.

- The installer keeps no list of coding agents. Agent detection and choice belong to the skills CLI; never add an agent map or `--list-tools`.
- `skills` is a runtime dependency spawned through its bin, never `npx skills@1` (npx can reuse a stale cached version that lacks `add --json`).
- Never assume `.agents/skills`. A single-agent install copies into that agent's folder only; read skill locations from `skills list --json`.
- Screens and messages come from `modules.yaml` and `messages.yaml`.
- Check claims about the skills CLI against its shipped bundle in `node_modules/skills`, not its docs.
