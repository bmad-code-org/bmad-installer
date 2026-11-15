# bmad-installer

`npm test` runs the unit tests, `npm run check` runs tsc, `npm run e2e` runs the end-to-end tests.

- `agents.json` is the skills CLI's agent table, generated from the pinned bundle by `npm run agents`. Never edit it by hand. `skills` stays pinned to an exact version; after a bump, regenerate it in the same change (the parity test in `test/agents.test.js` fails until you do).
- Every `skills add` runs headless (`-y --json`) with `-a` from the installer's own agent choice. Never hand the terminal to the skills CLI.
- `skills` is a runtime dependency spawned through its bin, never `npx skills@1` (npx can reuse a stale cached version that lacks `add --json`).
- Never assume `.agents/skills`. A single-agent install copies into that agent's folder only; read skill locations from `skills list --json`.
- Screens and messages come from `modules.yaml` and `messages.yaml`. The `--help` text and the usage errors are the exception: they live with the flags in `src/cli.js`.
- `npm run check` fails on unused locals and parameters. Delete dead code, do not prefix it away.
- Check claims about the skills CLI against its shipped bundle in `node_modules/skills`, not its docs.
