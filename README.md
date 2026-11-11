# bmad-method

## What it does

`bmad-method` installs BMad modules into a project as agent skills. It asks which modules you want, runs the Vercel skills CLI (the `skills` npm package, shipped as a dependency) to install them, then reads the install with the `bmad` skill's setup script and prints a report. It copies no files itself, keeps no state of its own, and never removes anything.

## Install commands

Needs Node 22 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/) on your PATH.

```
npx bmad-method            install into the current directory
npx bmad-method install    the same thing
npx bmad-method update     update the BMad skills already installed
npx bmad-method status     show what is installed and what is still missing
```

## Example

Interactive, in a terminal:

```
npx bmad-method
```

It asks where to install, which modules you want and which coding agents get the skills. Each module installs whole; to pick single skills, use `npx skills add` directly. The installer then runs the skills CLI without prompts. The closing message names the directory and tells you to run `bmad setup` in your coding agent. It also shows the `npx bmad-method` command that repeats the install without prompts.

Headless, for scripts and CI:

```
npx bmad-method install -d ./my-app -m method,cis -t claude-code,codex -y
```

## Where it can run

An interactive run needs a real terminal. It refuses to start inside a coding agent such as Claude Code or Codex, because the prompts cannot be answered there. Add `--yes` to run without prompts anywhere. `update` and `status` never prompt.

## Choosing coding agents

The agent list is the skills CLI's own, copied into `agents.json` from the skills CLI version this installer ships with. `npx bmad-method --list-tools` prints the ids. Many agents (Codex, Cursor, Gemini CLI, GitHub Copilot and others) read the same `.agents/skills` folder, so the installer treats them as one choice, the `universal` id. Naming any of them in `--tools` means that folder.

- Interactive without `--tools`: the installer shows a searchable agent picker. It preselects the agents that already hold BMad in this project, otherwise your last pick in the skills CLI, otherwise the agents found on this machine.
- `--tools <ids>`: every install goes to those agents and the picker never shows. Ids and display names both work. An unknown id stops the run before anything installs.
- `--yes` without `--tools`: every agent found on this machine, the way the skills CLI's own `--yes` picks. When none is found, the shared `.agents/skills` folder only (the `universal` id).

## Where skills land

The skills CLI decides. With one agent it copies the skills into that agent's folder, for example `.claude/skills`. With several agents it writes them once to `.agents/skills` and links each agent's folder to them. `npx bmad-method status` reads the real locations with `npx skills list`.

## Flags

| Flag | What it does |
| --- | --- |
| `-d, --directory <path>` | Project directory, default the current one |
| `-m, --modules <codes>` | Comma-separated module codes to install, e.g. `method,cis` |
| `-t, --tools <ids>` | Comma-separated coding agent ids to install to |
| `--list-tools` | List the coding agent ids `--tools` takes |
| `-y, --yes` | Take the defaults and ask nothing |
| `--action <name>` | `install`, `update` or `quick-update`. Kept so scripts written for the 6.12 installer still work |
| `--no-telemetry` | Turn off skills CLI telemetry and the skills.sh install counts |
| `--copy` | Copy skills instead of linking, if symlinks fail on your system |
| `--debug` | Print every child command, its cwd and its output to stderr |
| `-h, --help` | Show the help |
| `-v, --version` | Show the version |

`--modules` takes module codes: `method` (alias `bmm`), `toolsmith`, `founder` and `cis`. Without `--modules`, `--yes` installs `method` and `toolsmith`. The core tools module installs on every run. Each module installs whole, with one `npx skills add <owner/repo/folder> -s '*'` for its folder; a module already installed with nothing missing is skipped.

A 6.12 flag this installer dropped prints one line about it, then exits without installing.

## What the closing message tells you

The closing message names the directory BMad went into and asks you to open your coding agent there and tell it to run `bmad setup`. Setup asks the configuration questions and finishes the install. Configuration and customization belong to the `bmad` skill from then on; this installer never asks those questions.

## Updating

Three routes: ask the `bmad` skill, run `npx bmad-method update`, or run `npx skills update`.

`npx bmad-method update` runs the skills CLI update over the project's skills, then prints the status report and any migrations for the version jump.

After adding or updating any skill by any route, ask the `bmad` skill to update. Only it reconciles what is installed.

## Removing

`npx skills remove` removes skills. This installer has no uninstall command and never removes anything.

## Installing with the skills CLI directly

If you install with the skills CLI directly, install a module from its folder: `npx skills add bmad-code-org/BMAD-METHOD/skills/method --skill '*'` installs BMad Method, record included. Core tools (`skills/core-tools`) hold the `bmad` skill, so install them first. A module is its record skill plus the skills that record lists. The record is a `bmod-<code>` skill, or, for a module of one skill, that skill itself. A record without its skills, or skills without their record, is a partial install: the `bmad` skill cannot see or run it. `npx bmad-method status` lists missing records and unmet requirements.

## Troubleshooting

- `status` and `update` take 5 to 10 seconds. The `bmad` skill's setup script reads each module's record from GitHub on every call.
- `npx skills update` currently skips the `bmad` skill because BMAD-METHOD ships a second `bmad` SKILL.md in a test fixture.
- `npx skills update` re-adds skills without the agent list, which can change where they land. `npx bmad-method update` has the same limit.
- Symlink errors on Windows: add `--copy`.
- `--debug` prints every child command with its output.

## Telemetry

The installer sends nothing. The skills CLI it runs sends two GET requests to `add-skill.vercel.sh`: an audit call to `https://add-skill.vercel.sh/audit` before an install, carrying the `owner/repo` and the skill names, and an install event to `https://add-skill.vercel.sh/t` after it, carrying the source, the skill names, the agent ids and the CLI version. The install event goes out only for a public GitHub repo. The audit call is not gated on repo visibility: it goes out for a private GitHub repo too. A local path sends neither. No file contents leave the machine. The install event carries the metadata this installer attaches: `{"installer":"bmad-method","version":"<installer version>"}`.

`--no-telemetry` sets `DO_NOT_TRACK=1` in every skills CLI process the installer starts. That also removes those installs from the install counts on skills.sh.

`DO_NOT_TRACK` or `DISABLE_TELEMETRY` set in your own environment turns telemetry off for every skills command, including the ones you run yourself.

## Reproducible installs

The skills CLI writes `skills-lock.json` in the project. Commit it. `npx skills experimental_install` restores the skills recorded there.

## Testing

`npm test` runs the unit tests with `node --test`. `npm run check` runs `tsc` over `bin`, `src` and `test`.

`npm run e2e` runs the end-to-end install. It skips itself unless `BMAD_INSTALLER_E2E_SOURCE` points at a local BMAD-METHOD checkout. The test passes that path to the child run as `BMAD_INSTALLER_SOURCE_OVERRIDE`, which swaps the repository of every module from the core tools repository for that path and keeps each module's folder. A `#ref` at the end selects a branch or tag: `BMAD_INSTALLER_SOURCE_OVERRIDE='bmad-code-org/BMAD-METHOD#dev'` installs from `dev` on GitHub. Set `BMAD_INSTALLER_E2E_DEBUG` to log every child command. `BMAD_INSTALLER_SOURCE_OVERRIDE` exists for this test; do not set it for a real install.

## Releasing

See [tools/release.md](tools/release.md).

## License

MIT. See [LICENSE](LICENSE).
