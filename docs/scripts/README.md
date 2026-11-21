# Repo scripts

Small Node ESM utilities for the Rose monorepo. They use only Node built-ins and print deterministic
output. `--json` makes stdout machine-readable; progress and diagnostics go to stderr when JSON is
requested.

| Script        | Command                                                 | What it does                                                               |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dev.mjs`     | `node docs/scripts/dev.mjs <start\|status\|stop\|logs>` | Starts, probes, stops, and tails detached dev services (api, web, mobile)  |
| `doctor`      | `node docs/scripts/doctor.mjs`                          | Checks Node/pnpm versions, tools, ports, dev state, Expo metadata, and git |
| `clean`       | `node docs/scripts/clean.mjs [--yes]`                   | Lists (dry run) or removes generated caches                                |
| `repo-status` | `node docs/scripts/repo-status.mjs`                     | Branch, sync state, dirty files, services, Expo URL, PR and checks         |
| `review-prep` | `node docs/scripts/review-prep.mjs [--base origin/dev]` | Self-review: changed files, diff stat, guard issues, test suggestions      |
| `ci-inspect`  | `node docs/scripts/ci-inspect.mjs [pr] [--logs]`        | PR checks, failures, pending checks and failed-run log excerpts            |
| `pr-open`     | `node docs/scripts/pr-open.mjs [--yes]`                 | Dry-run plan, then verify/push/open a feature PR to dev                    |
| `affected`    | `node docs/scripts/affected.mjs [--base origin/dev]`    | Changed packages and the exact test/lint/type commands                     |
| `guard`       | `node docs/scripts/guard.mjs [--staged\|--diff]`        | Secrets, `.env`, generated paths and large files in the diff               |
| `worktree`    | `node docs/scripts/worktree.mjs <new\|list\|remove>`    | Isolated worktrees under `../rose-worktrees`                               |
| `sync`        | `node docs/scripts/sync.mjs [--prune]`                  | Fast-forwards dev/staging/main and optionally deletes merged branches      |
| `expo`        | `node docs/scripts/expo.mjs <url\|qr> [--open]`         | Expo Go URL/QR from `mobileRose/.expo/rose-dev.json`                       |
| `deps-check`  | `node docs/scripts/deps-check.mjs`                      | Read-only outdated pnpm, Expo and Go dependencies                          |
| `release`     | `node docs/scripts/release.mjs <vX.Y.Z> [--yes]`        | Validates main/CI/tag, then creates and pushes an annotated tag            |
| `docs-check`  | `node docs/scripts/docs-check.mjs`                      | Links, Markdown placement, AGENTS.md, lockfile, tests, script registry     |
| `promote`     | `node docs/scripts/promote.mjs <name>`                  | Plans (dry run) or executes the dev -> staging -> main promotion           |

## Examples

```powershell
# Situation + self-review before a PR
pnpm repo:status
pnpm review:prep
pnpm affected
pnpm guard
pnpm docs:check

# Background services with a registry and per-service logs
pnpm dev:start                 # or: node docs/scripts/dev.mjs start
pnpm dev:start -- --json
pnpm dev:status -- --json
node docs/scripts/dev.mjs logs api --lines 5
pnpm dev:stop -- --json

# Review a PR's checks and failures
pnpm ci:inspect 37
pnpm ci:inspect 37 -- --logs

# Feature PR (dry run, then execute)
pnpm pr:open --title "feat: ..." --body-file body.md
node docs/scripts/pr-open.mjs --yes --verify

# Isolated worktree for a parallel agent
pnpm worktree:new feat/my-task
pnpm worktree:list
pnpm worktree:remove feat/my-task -- --yes

# Branch hygiene
pnpm sync
node docs/scripts/sync.mjs --yes --prune

# Mobile handoff
pnpm expo:url
pnpm expo:qr -- --open

# Maintenance
pnpm deps:check
pnpm release v0.1.0
pnpm docs:check

# Environment diagnosis
pnpm doctor:repo
node docs/scripts/doctor.mjs --json

# Cache cleanup (dry run unless --yes)
pnpm clean
pnpm clean -- --json
node docs/scripts/clean.mjs --yes

# Promotion (prints the plan unless --yes)
pnpm promote release-1
node docs/scripts/promote.mjs release-1 --json
node docs/scripts/promote.mjs release-1 --yes
```

`pnpm doctor` is pnpm's built-in command, not this repo's script; use `pnpm doctor:repo` or the direct
`node` command above.

`pnpm dev` still runs the services in the foreground through Turborepo. `dev:start` is the detached
alternative: it writes `.dev/services.json`, logs to `.dev/logs/<service>.out.log` and
`.err.log`, and picks free ports starting at 8080 (api), 3000 (web), and 8081 (mobile). Mobile
readiness comes from `mobileRose/.expo/rose-dev.json` and its `expoGoUrl` uses the `exp://` scheme.

## JSON output

| Script       | `--json` payload                                                                     |
| ------------ | ------------------------------------------------------------------------------------ |
| `dev`        | The service registry (`startedAt`, `services`, `stoppedAt` after stop)               |
| `doctor`     | `{ ok, checkedAt, summary: { ok, warn, fail }, checks: [{ name, status, detail }] }` |
| `clean`      | `{ dryRun, refused, targets, totalBytes }` or `{ dryRun: false, deleted, failed }`   |
| `docs-check` | `{ ok, files, issues: [{ type, file, line, detail }] }`                              |
| `promote`    | Dry run: `{ dryRun: true, name, branch, merge, prs, commits, steps }`                |

`dev.mjs logs` also accepts `--json` and returns the last lines of each log file.

## Structure gates

`pnpm docs:check` enforces Markdown placement, a single root `AGENTS.md`, the docs index, one
`pnpm-lock.yaml`, test placement and the `docs/scripts` registry. It runs inside `pnpm verify` and in
CI. `.husky/pre-commit` also runs `guard --staged`, so misplaced Markdown, secrets, generated files
and forbidden lockfiles fail before the commit is created. CI runs the same guard on the PR diff.

## Safety

- `clean`, `pr:open`, `worktree new/remove`, `sync` and `promote` are **dry runs by default**. Nothing is
  deleted, pushed, or merged without `--yes`.
- `guard` and `repo:status` are read-only.
- `release` requires a clean `main` at `origin/main`, an existing successful `CI` run for the exact
  commit, and a new `vX.Y.Z` tag.
- `clean` refuses to run while `.dev/services.json` has live PIDs. Run `pnpm dev:stop` first.
- `promote --yes` verifies a clean tree on `dev`, requires `gh` authentication, fetches `origin`,
  refuses an empty `origin/main..origin/dev`, and stops at the first failing check with the PR URL
  and the exact next command. It never force-pushes and never pushes to a protected branch.
- `sync --yes` only fast-forwards branches with no unique commits; it never force-pushes or rewrites
  history.
- `clean --yes` only removes the generated paths listed in the script. It never touches source files.

## Prerequisites

| Tool     | Needed for                    | Missing behavior                         |
| -------- | ----------------------------- | ---------------------------------------- |
| Node 24  | All scripts (`.node-version`) | Scripts cannot run                       |
| pnpm     | `dev` service spawning        | `doctor` fails; `dev:start` cannot spawn |
| `gh`     | `promote`                     | `doctor` warns; `promote --yes` fails    |
| `go`     | The api dev service           | `doctor` warns; `dev:start` api fails    |
| `adb`    | Mobile device work (optional) | `doctor` warns                           |
| `docker` | Local containers (optional)   | `doctor` warns                           |

## Files

| Path                             | Purpose                                |
| -------------------------------- | -------------------------------------- |
| `.dev/services.json`             | Service registry (gitignored)          |
| `.dev/logs/<service>.out.log`    | stdout of a detached service           |
| `.dev/logs/<service>.err.log`    | stderr of a detached service           |
| `mobileRose/.expo/rose-dev.json` | Expo Go URL, port, QR path, and status |
