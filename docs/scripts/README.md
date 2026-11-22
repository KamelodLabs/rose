# Repo scripts

Small Node ESM utilities for the Rose monorepo. They use only Node built-ins and print deterministic
output. `--json` makes stdout machine-readable; progress and diagnostics go to stderr when JSON is
requested.

| Script           | Command                                                      | What it does                                                               |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `dev.mjs`        | `node docs/scripts/dev.mjs <start\|status\|stop\|logs>`      | Starts, probes, stops, and tails detached dev services (api, web, mobile)  |
| `doctor`         | `node docs/scripts/doctor.mjs`                               | Checks Node/pnpm versions, tools, ports, dev state, Expo metadata, and git |
| `clean`          | `node docs/scripts/clean.mjs [--yes]`                        | Lists (dry run) or removes generated caches                                |
| `repo-status`    | `node docs/scripts/repo-status.mjs`                          | Branch, sync state, dirty files, services, Expo URL, PR, review and checks |
| `review-prep`    | `node docs/scripts/review-prep.mjs [--base origin/dev]`      | Self-review: changed files, diff stat, guard issues, test suggestions      |
| `ci-inspect`     | `node docs/scripts/ci-inspect.mjs [pr] [--logs]`             | PR checks, failures, pending checks and failed-run log excerpts            |
| `ci-watch`       | `node docs/scripts/ci-watch.mjs [pr] [--interval <seconds>]` | Live `gh pr checks --watch --fail-fast`; JSON summary                      |
| `pr-open`        | `node docs/scripts/pr-open.mjs [--yes]`                      | Dry-run plan, then verify/push/open a feature PR to dev                    |
| `pr-review`      | `node docs/scripts/pr-review.mjs [pr] [--approve\|...]`      | Read-only review summary or submit an approve/comment/changes review       |
| `pr-merge`       | `node docs/scripts/pr-merge.mjs [pr] [--yes]`                | Review-gated merge; dry run unless `--yes`                                 |
| `affected`       | `node docs/scripts/affected.mjs [--base origin/dev]`         | Changed packages and the exact test/lint/type commands                     |
| `guard`          | `node docs/scripts/guard.mjs [--staged\|--diff]`             | Secrets, `.env`, generated paths and large files in the diff               |
| `worktree`       | `node docs/scripts/worktree.mjs <new\|list\|remove>`         | Isolated worktrees under `../rose-worktrees`                               |
| `sync`           | `node docs/scripts/sync.mjs [--prune]`                       | Fast-forwards dev/staging/main and optionally deletes merged branches      |
| `expo`           | `node docs/scripts/expo.mjs <url\|qr> [--open]`              | Expo Go URL/QR from `mobileRose/.expo/rose-dev.json`                       |
| `deps-check`     | `node docs/scripts/deps-check.mjs`                           | Read-only outdated pnpm, Expo and Go dependencies                          |
| `release`        | `node docs/scripts/release.mjs <vX.Y.Z> [--yes]`             | Validates main/CI/tag, then creates and pushes an annotated tag            |
| `docs-check`     | `node docs/scripts/docs-check.mjs`                           | Links, Markdown placement, AGENTS.md, lockfile, tests, script registry     |
| `modularity`     | `node docs/scripts/modularity.mjs [--json]`                  | Src areas, feature/shared shape, module packages, Go platform, imports     |
| `promote`        | `node docs/scripts/promote.mjs <name>`                       | Plans or executes dev -> staging -> main, pausing at review gates          |
| `promote-status` | `node docs/scripts/promote-status.mjs <name>`                | Read-only staging/main PR, checks, review and next-action status           |

## Examples

```powershell
# Situation + self-review before a PR
pnpm repo:status
pnpm review:prep
pnpm affected
pnpm guard
pnpm modularity
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
pnpm ci:watch 37
pnpm ci:watch 37 -- --interval 30

# Review and merge a PR (no auto-merge)
pnpm pr:review 37
pnpm pr:review 37 -- --approve -b "Looks good"
pnpm pr:merge 37
pnpm pr:merge 37 --yes

# Maintainer self-review: comment, review, then merge
pnpm pr:review 37 -- --comment -b "Self-review: tests and boundaries checked"
pnpm pr:merge 37 --yes --self-reviewed

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

# Promotion (prints the plan unless --yes; pauses for review)
pnpm promote release-1
pnpm promote release-1 --yes
pnpm promote:status release-1
pnpm pr:review 60 -- --approve -b "Promotion reviewed"
pnpm promote release-1 --resume --yes
pnpm promote release-1 --resume --yes --self-reviewed  # maintainer after self-review
```

`pnpm doctor` is pnpm's built-in command, not this repo's script; use `pnpm doctor:repo` or the direct
`node` command above.

`pnpm dev` still runs the services in the foreground through Turborepo. `dev:start` is the detached
alternative: it writes `.dev/services.json`, logs to `.dev/logs/<service>.out.log` and
`.err.log`, and picks free ports starting at 8080 (api), 3000 (web), and 8081 (mobile). Mobile
readiness comes from `mobileRose/.expo/rose-dev.json` and its `expoGoUrl` uses the `exp://` scheme.

## JSON output

| Script           | `--json` payload                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `dev`            | The service registry (`startedAt`, `services`, `stoppedAt` after stop)                      |
| `doctor`         | `{ ok, checkedAt, summary: { ok, warn, fail }, checks: [{ name, status, detail }] }`        |
| `clean`          | `{ dryRun, refused, targets, totalBytes }` or `{ dryRun: false, deleted, failed }`          |
| `docs-check`     | `{ ok, files, issues: [{ type, file, line, detail }] }`                                     |
| `modularity`     | `{ ok, violations: [{ file, line, rule, message }] }`                                       |
| `ci-watch`       | `{ ok, pr: { number, url }, checks }`; exit 1 when the watch fails                          |
| `pr-review`      | Summary `{ ok, pr, checks, reviewDecision, latestReviews, readiness }`; action `{ ... }`    |
| `pr-merge`       | `{ ok, dryRun, pr, strategy, review, checks, blockers, next }` or `{ alreadyMerged: true }` |
| `promote`        | `{ ok, name, stage, paused, done, prs, next }`; dry run adds `dryRun` and `commits`         |
| `promote-status` | `{ ok, name, branch, stage, done, prs: { staging, main }, next }`                           |

`dev.mjs logs` also accepts `--json` and returns the last lines of each log file.

## Structure gates

`pnpm docs:check` enforces Markdown placement, a single root `AGENTS.md`, the docs index, one
`pnpm-lock.yaml`, test placement and the `docs/scripts` registry. `pnpm modularity` enforces the
feature/shared module shape and import direction in web and mobile, plus the Go platform direction.
Both run inside `pnpm verify` and in CI. `.husky/pre-commit` also runs `guard --staged`, so misplaced Markdown, secrets, generated files
and forbidden lockfiles fail before the commit is created. CI runs the same guard on the PR diff.

The modularity scanner reads static imports, re-exports, side-effect imports, dynamic imports, and
`require()` calls. It skips generated/build directories. It rejects module-level `package.json` files,
`packages/` and unexpected technical-layer directories at the app `src` root, missing feature
`index.ts` files, cross-feature imports, deep feature imports from `app`, relative imports that escape
their module or app, and domain imports from `apiRose/internal/platform`. The rule set is defined in
`docs/monorepo/09-modularization.md`.

## Review gate

Every PR requires review before merge. `pnpm pr:review` is a read-only summary by default and submits
a review only with an explicit action plus `--yes`. `pnpm pr:merge` refuses without a non-author
approval; maintainers may use `--self-reviewed` after reviewing their own PR. No script uses
`gh pr merge --auto`, and no script adds a static check timeout: `gh pr checks --watch --fail-fast`
waits for the checks to settle.

Configure branch protection on `dev` (and `staging`/`main`) with at least one required approval. The
scripts are a local guard, not a replacement for branch protection. Admins may need a bypass policy
or another maintainer to approve their own PRs.

## Safety

- `clean`, `pr:open`, `pr:merge`, `worktree new/remove`, `sync` and `promote` are **dry runs by
  default**. Nothing is deleted, pushed, or merged without `--yes`.
- `guard`, `repo:status`, `ci:watch`, `pr:review` without an action, and `promote:status` are
  read-only.
- `release` requires a clean `main` at `origin/main`, an existing successful `CI` run for the exact
  commit, and a new `vX.Y.Z` tag.
- `clean` refuses to run while `.dev/services.json` has live PIDs. Run `pnpm dev:stop` first.
- `promote --yes` verifies a clean tree on `dev`, requires `gh` authentication, fetches `origin`,
  refuses an empty `origin/main..origin/dev`, and pauses at each review gate. Resume with
  `--resume`; maintainers may add `--self-reviewed` after reviewing. It never force-pushes, never
  pushes to a protected branch, and never uses `--auto` or `--admin`.
- `pr:merge --yes` requires the review gate, waits for checks to register with backoff (no static timeout), re-fetches the
  PR, and then merges with an explicit strategy. `--self-reviewed` requires `ADMIN`/`MAINTAIN`.
- `sync --yes` only fast-forwards branches with no unique commits; it never force-pushes or rewrites
  history.
- `clean --yes` only removes the generated paths listed in the script. It never touches source files.

## Prerequisites

| Tool     | Needed for                              | Missing behavior                            |
| -------- | --------------------------------------- | ------------------------------------------- |
| Node 24  | All scripts (`.node-version`)           | Scripts cannot run                          |
| pnpm     | `dev` service spawning                  | `doctor` fails; `dev:start` cannot spawn    |
| `gh`     | PR review/merge, `ci:watch`, promotions | `doctor` warns; those commands fail clearly |
| `go`     | The api dev service                     | `doctor` warns; `dev:start` api fails       |
| `adb`    | Mobile device work (optional)           | `doctor` warns                              |
| `docker` | Local containers (optional)             | `doctor` warns                              |

## Files

| Path                             | Purpose                                |
| -------------------------------- | -------------------------------------- |
| `.dev/services.json`             | Service registry (gitignored)          |
| `.dev/logs/<service>.out.log`    | stdout of a detached service           |
| `.dev/logs/<service>.err.log`    | stderr of a detached service           |
| `mobileRose/.expo/rose-dev.json` | Expo Go URL, port, QR path, and status |
