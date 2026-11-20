# Day-to-day commands

Everything is driven from the repo root. Most root scripts fan out through Turborepo; `format`,
`format:check`, `prepare`, `quality`, `quality:duplication`, and `quality:unused` run directly. Filters
narrow the work to one project. Use this page as the command reference.

## Quick path

```powershell
pnpm install      # once; `prepare` installs the Husky hooks
pnpm dev          # web + API + mobile (Expo) in parallel
pnpm test         # Vitest (web) + Jest (mobile) + go test (api)
pnpm quality      # jscpd duplication + knip unused-code gates
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

| Script                     | What it does                                             | Scope     |
| -------------------------- | -------------------------------------------------------- | --------- |
| `pnpm dev`                 | Persistent dev servers, no cache                         | all       |
| `pnpm build`               | Production builds                                        | web + api |
| `pnpm lint`                | `eslint`, `expo lint`, `go vet`                          | all       |
| `pnpm check-types`         | `next typegen && tsc --noEmit`, `tsc --noEmit`, `go vet` | all       |
| `pnpm test`                | Vitest (web), Jest (mobile), `go test ./...` (api)       | all       |
| `pnpm quality`             | `quality:duplication` then `quality:unused`              | repo      |
| `pnpm quality:duplication` | jscpd; fails above the 7% duplication threshold          | repo      |
| `pnpm quality:unused`      | knip with `--max-issues 0`; fails on any unused file/dep | repo      |
| `pnpm format`              | Prettier write over the repo                             | all files |
| `pnpm format:check`        | Prettier check (CI-friendly)                             | all files |
| `pnpm prepare`             | Installs the Husky Git hooks (runs on `pnpm install`)    | repo      |

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
- [ ] You know how to force a rebuild when the cache lies.

## Next step

Pick the app you're working on: [03-api.md](./03-api.md) · [04-web.md](./04-web.md) ·
[05-mobile.md](./05-mobile.md).
