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

It asks where to install, which modules and which parts of each module you want. The first skills install then hands over to the skills CLI, which shows its own agent picker if it finds none or several coding agents in the project. Later installs in the same run reuse that pick. The closing message names the directory and tells you to run `bmad setup` in your coding agent.

Headless, for scripts and CI:

```
npx bmad-method install -d ./my-app -m method:planning+build,cis -t claude-code,codex -y
```

## Where it can run

An interactive run needs a real terminal. It refuses to start inside a coding agent such as Claude Code or Codex, because the prompts cannot be answered there. Add `--yes` to run without prompts anywhere. `update` and `status` never prompt.

## Choosing coding agents

The installer keeps no list of coding agents. Agent ids and detection come from the skills CLI.

- Interactive without `--tools`: the skills CLI detects agents and shows its picker when it needs a choice. The pick is reused for the rest of the run.
- `--tools <ids>`: every install goes to those agents and the picker never shows. The [skills CLI README](https://github.com/vercel-labs/skills#supported-agents) lists the valid ids.
- `--yes` without `--tools`: the skills CLI chooses from the agents it detects.

## Where skills land

The skills CLI decides. With one agent it copies the skills into that agent's folder, for example `.claude/skills`. With several agents it writes them once to `.agents/skills` and links each agent's folder to them. `npx bmad-method status` reads the real locations with `npx skills list`.

## Flags

| Flag | What it does |
| --- | --- |
| `-d, --directory <path>` | Project directory, default the current one |
| `-m, --modules <spec>` | Modules to install, e.g. `method:planning+build,cis` |
| `-t, --tools <ids>` | Comma-separated skills CLI agent ids to install to |
| `-y, --yes` | Take the defaults and ask nothing |
| `--action <name>` | `install`, `update` or `quick-update`. Kept so scripts written for the 6.12 installer still work |
| `--no-telemetry` | Turn off skills CLI telemetry and the skills.sh install counts |
| `--copy` | Copy skills instead of linking, if symlinks fail on your system |
| `--debug` | Print every child command, its cwd and its output to stderr |
| `-h, --help` | Show the help |
| `-v, --version` | Show the version |

`--modules` takes module codes. `method` (alias `bmm`) has the bundles `planning`, `build`, `agents` and `extras`; `cis` has none. A module named without `:` takes its default bundles. The core tools module installs on every run.

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

If you install with the skills CLI directly, a module is its `bmod-<code>` record skill plus the skills that record lists. A record without its skills, or skills without their record, is a partial install: the `bmad` skill cannot see or run it. `npx bmad-method status` lists missing records and unmet requirements.

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

`npm run e2e` runs the end-to-end install. It skips itself unless `BMAD_INSTALLER_E2E_SOURCE` points at a local BMAD-METHOD checkout. The test passes that path to the child run as `BMAD_INSTALLER_SOURCE_OVERRIDE`, which makes module loading replace every module's source with it. Set `BMAD_INSTALLER_E2E_DEBUG` to log every child command. `BMAD_INSTALLER_SOURCE_OVERRIDE` exists for this test; do not set it for a real install.

## Releasing

See [tools/release.md](tools/release.md).

## License

MIT. See [LICENSE](LICENSE).
