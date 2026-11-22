# Day-to-day commands

Everything is driven from the repo root. `dev`, `build`, `lint`, `check-types`, and `test` enter the
Turbo task graph; `verify`, `dev:start`, `dev:status`, `dev:stop`, `dev:logs`, `doctor:repo`, `clean`,
`promote`, `format`, `format:check`, `prepare`, and `quality` run directly. Filters narrow the work to
one project. Use this page as the command reference.

## Quick path

```powershell
pnpm install      # once; `prepare` installs the Husky hooks
pnpm dev          # web + API + mobile in the foreground
pnpm dev:start    # background services; state in .dev/services.json
pnpm dev:status   # ports, URLs, PIDs and health
pnpm test         # Vitest (web) + Jest (mobile) + go test (api)
pnpm quality      # jscpd duplication + knip unused-code gates
pnpm modularity   # feature/shared, src areas, Go platform, and import boundary check
pnpm verify       # full gate before a PR
pnpm check-types  # TypeScript + go vet
pnpm lint         # eslint + expo lint + go vet
pnpm build        # web + api (mobile is built by EAS)
```

Stop `pnpm dev` with `Ctrl+C`; Turbo terminates all child tasks. To run mobile alone, use
`pnpm --filter @rose/mobileRose start`. The mobile `start`/`dev` scripts are agent-friendly wrappers:
they write `.expo/rose-dev.json` and `.expo/expo-go-qr.png`, and pick the first free port from 8081.

## Root scripts

`dev`, `build`, `lint`, `check-types`, and `test` enter the Turbo task graph; the rest run directly at
the root.

| Script                     | What it does                                                               | Scope     |
| -------------------------- | -------------------------------------------------------------------------- | --------- |
| `pnpm dev`                 | Persistent dev servers, no cache                                           | all       |
| `pnpm build`               | Production builds                                                          | web + api |
| `pnpm lint`                | `eslint`, `expo lint`, `go vet`                                            | all       |
| `pnpm check-types`         | `next typegen && tsc --noEmit`, `tsc --noEmit`, `go vet`                   | all       |
| `pnpm test`                | Vitest (web), Jest (mobile), `go test ./...` (api)                         | all       |
| `pnpm quality`             | `quality:duplication` then `quality:unused`                                | repo      |
| `pnpm quality:duplication` | jscpd; fails above the 7% duplication threshold                            | repo      |
| `pnpm quality:unused`      | knip with `--max-issues 0`; fails on any unused file/dep                   | repo      |
| `pnpm modularity`          | Checks module shape, src areas, package.json, Go platform, imports         | repo      |
| `pnpm verify`              | `format:check` + lint + types + test + quality + modularity + docs + build | repo      |
| `pnpm dev:start`           | Background API/web/mobile + `.dev/services.json`                           | all       |
| `pnpm dev:status`          | Probe registered services and refresh their statuses                       | all       |
| `pnpm dev:stop`            | Stop the registered process trees                                          | all       |
| `pnpm dev:logs`            | Tail a service log (`.dev/logs/`)                                          | all       |
| `pnpm doctor:repo`         | Toolchain, ports, metadata and git diagnosis                               | repo      |
| `pnpm clean`               | Dry-run generated caches; `--yes` deletes                                  | repo      |
| `pnpm promote <name>`      | Dry-run promotion; pauses at review; `--yes` executes                      | repo      |
| `pnpm promote:status`      | Read-only staging/main PR, checks, and review status                       | repo      |
| `pnpm pr:review [pr]`      | Read-only review summary, or submit a review with an action                | repo      |
| `pnpm pr:merge [pr]`       | Dry-run merge plan; `--yes` enforces review and watches checks             | repo      |
| `pnpm ci:watch [pr]`       | Live `gh pr checks --watch --fail-fast`; no static timeout                 | repo      |
| `pnpm docs:check`          | Links, Markdown placement, AGENTS, lockfile, tests                         | repo      |
| `pnpm format`              | Prettier write over the repo                                               | all files |
| `pnpm format:check`        | Prettier check (CI-friendly)                                               | all files |
| `pnpm prepare`             | Installs the Husky Git hooks (runs on `pnpm install`)                      | repo      |

## Agent utilities

`docs/scripts/` holds deterministic helpers (see `docs/scripts/README.md`). For machine-readable
output, call the scripts directly:

```powershell
node docs/scripts/dev.mjs start|status|stop --json
node docs/scripts/doctor.mjs --json
node docs/scripts/clean.mjs --json
node docs/scripts/promote.mjs <name> --json
node docs/scripts/docs-check.mjs --json
node docs/scripts/modularity.mjs --json
```

`modularity --json` returns `{ ok, violations: [{ file, line, rule, message }] }`; the command exits 1
when a boundary is violated.

Use the direct `node` form when you need exact flags. `pnpm doctor` is pnpm's built-in command; use
`pnpm doctor:repo` or `node docs/scripts/doctor.mjs`.

## Review and merge

Every PR requires review before merge. No script uses `gh pr merge --auto`, and checks are watched
with `gh pr checks --watch --fail-fast` without a static timeout; it waits for checks to register with
backoff.

```powershell
pnpm pr:review 37                    # read-only summary and checklist
pnpm pr:review 37 -- --approve -b "Looks good"
pnpm pr:merge 37                     # dry run with blockers and next step
pnpm ci:watch 37                     # live check output
pnpm pr:merge 37 --yes               # re-checks the review gate, then merges
```

A non-author approval satisfies the gate. Maintainers may review their own PR, then use
`pnpm pr:merge <n> --yes --self-reviewed`. Branch protection on `dev` (and `staging`/`main`) should
require at least one approval; the scripts are a local guard, not a replacement. Admins may need a
bypass policy or another maintainer for their own PRs.

Promotions pause at both review gates. After reviewing, resume:

```powershell
pnpm promote release-1 --yes
pnpm promote:status release-1
pnpm pr:review 60 -- --approve -b "Promotion reviewed"
pnpm promote release-1 --resume --yes
```

Maintainers can use `--resume --yes --self-reviewed` after reviewing their own staging PR. The newly
created main PR always pauses for review, even in the same run.

## Filtering

```powershell
# Turbo filter (recommended, explicit)
pnpm exec turbo run build --filter=@rose/webRose
pnpm exec turbo run check-types --filter=@rose/apiRose

# pnpm filter (runs that package's own script)
pnpm --filter @rose/mobileRose start
pnpm --filter @rose/apiRose dev
```

Filters accept multiple values: `--filter=@rose/webRose --filter=@rose/apiRose`.

## App scripts

Root commands cover the common path. App-level extras:

- `pnpm --filter @rose/webRose test` (Vitest once) and
  `pnpm --filter @rose/webRose test:watch` (watch mode).
- `pnpm --filter @rose/mobileRose test` (Jest once) and
  `pnpm --filter @rose/mobileRose test:watch` (watch mode).
- `pnpm --filter @rose/mobileRose start` or `dev` (agent-friendly Expo Go wrapper; writes
  `mobileRose/.expo/rose-dev.json` with `expoGoUrl` plus `.expo/expo-go-qr.png`).
- `pnpm --filter @rose/mobileRose start:localhost` (Expo `--localhost`, for emulator/USB).
- `pnpm --filter @rose/mobileRose start:tunnel` (Expo Go over the tunnel, for different networks).
- `pnpm --filter @rose/mobileRose start:plain` (stock `expo start`; pass normal Expo flags yourself).
- `pnpm --filter @rose/apiRose lint:complexity` runs gocyclo v0.6.0 with
  `-over 10 -ignore _test.go`.

## Ports

| Service         | Default URL             | How to change                                                        |
| --------------- | ----------------------- | -------------------------------------------------------------------- |
| API             | `http://localhost:8080` | `$env:PORT=9000; pnpm --filter @rose/apiRose dev`                    |
| Web             | `http://localhost:3000` | `pnpm --filter @rose/webRose exec next dev -p 3001`                  |
| Expo dev server | `http://localhost:8081` | The wrapper picks 8082+ automatically; `start:plain` for stock Expo. |

## Caching

Turbo caches task outputs in `.turbo/cache` (local only). A cache hit replays logs instead of
rerunning.

| Situation                         | Command                                |
| --------------------------------- | -------------------------------------- |
| Force a real rebuild              | `pnpm exec turbo run build --force`    |
| Inspect why a task ran            | `pnpm exec turbo run build --dry=json` |
| Drop all local cache              | delete `.turbo/` and rerun             |
| Prepare a Docker workspace subset | `pnpm exec turbo prune --help`         |

`turbo prune` prepares a subset of the workspace for Docker; it does not clear the cache. Delete
`.turbo/cache` to clear it.

`build` inputs include `.env*` files, so changing an env file invalidates the build cache.

CI restores Turbo from `.turbo/cache` and keeps Prettier's cache in `.cache/prettier`
(`prettier --check . --cache --cache-location .cache/prettier`). Both are disposable and rebuild on
demand.

## Structured output

For agents that need to parse results:

- `pnpm exec turbo run <task> --dry=json` prints the task graph.
- `pnpm exec turbo run <task> --json` prints NDJSON (experimental); add
  `--output-logs=errors-only` to reduce noise and `--continue` to run independent tasks after a
  failure.
- `pnpm install --reporter=append-only` is the non-TTY default; `--reporter=ndjson` is fully
  machine-readable.
- ESLint `-f json`, Vitest `--reporter=json`, and Jest `--json` are available for focused parsing.
- `node docs/scripts/modularity.mjs --json` reports boundary violations per file, line, and rule.

## Adding dependencies

| Where           | Command                                                  |
| --------------- | -------------------------------------------------------- |
| Web app         | `pnpm --filter @rose/webRose add <pkg>`                  |
| Web dev-only    | `pnpm --filter @rose/webRose add -D <pkg>`               |
| Mobile app      | `pnpm --filter @rose/mobileRose exec expo install <pkg>` |
| Mobile dev-only | `pnpm --filter @rose/mobileRose add -D <pkg>`            |
| Root tooling    | `pnpm add -Dw <pkg>`                                     |
| Go module       | `cd apiRose; go get <module>` then `go mod tidy`         |

Rules that prevent pain:

- **Expo native libraries:** always `expo install`, never plain `add`. Expo pins SDK-compatible
  versions; a free version breaks `expo install --check`.
- **React versions:** web and mobile both use React 19.3 today, but Expo owns its exact version. Do
  not force them to share a pnpm catalog.
- **One lockfile:** if `pnpm-lock.yaml` conflicts, regenerate from the root; never merge it by hand.

## Environment files

| App    | File                    | Prefix for exposed vars |
| ------ | ----------------------- | ----------------------- |
| web    | `webRose/.env.local`    | `NEXT_PUBLIC_`          |
| mobile | `mobileRose/.env.local` | `EXPO_PUBLIC_`          |
| api    | process env / shell     | plain env (`PORT`)      |

Env files are gitignored. A `.env.example` is allowed at the repo root, in `webRose`, and in
`mobileRose`; commit one when you need to share the variable list.

## Git hooks

`pnpm install` runs `prepare` -> `husky`, which installs the hooks in `.husky/`:

| Hook         | Runs                               | Effect                                            |
| ------------ | ---------------------------------- | ------------------------------------------------- |
| `pre-commit` | `pnpm exec lint-staged`            | Prettier only, on staged files                    |
| `commit-msg` | `pnpm exec commitlint --edit "$1"` | Rejects messages outside the allowed commit types |

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`.

- `pre-commit` does **not** lint or type-check; run `pnpm lint`, `pnpm check-types`, and `pnpm quality` before pushing.
- `git commit --no-verify` bypasses both hooks. It is a local escape hatch, not a workflow.
- Commitlint runs only locally; CI does not re-check commit messages.
- The web image build sets `HUSKY=0` because `.git` is excluded from the build context.
- On Windows, the hooks run through Git Bash and need `node` and `pnpm` on that PATH.

## Node and pnpm versions

`package.json` pins Node `>=22` (`engines`) and pnpm `10.33.4` (`packageManager`). `.npmrc` sets
`engine-strict=true`: an unsupported Node version **fails** `pnpm install` instead of warning.

## Checklist

- [ ] You always run `pnpm install` from the root.
- [ ] You use `expo install` for Expo native packages.
- [ ] You know `pnpm dev` starts web, API, and mobile.
- [ ] You run `pnpm modularity` after structural changes.
- [ ] You know how to force a rebuild when the cache lies.

## Next step

Pick the app you're working on: [03-api.md](./03-api.md) · [04-web.md](./04-web.md) ·
[05-mobile.md](./05-mobile.md).
