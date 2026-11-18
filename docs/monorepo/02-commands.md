# Day-to-day commands

Everything is driven from the repo root. Root scripts fan out through Turborepo; filters narrow the
work to one project. Use this page as the command reference.

## Quick path

```powershell
pnpm install      # once, after cloning or changing any package.json
pnpm dev          # all three apps in parallel
pnpm check-types  # TypeScript + go vet
pnpm lint         # eslint + expo lint + go vet
pnpm build        # web + api (mobile is built by EAS)
```

Stop `pnpm dev` with `Ctrl+C`; Turbo terminates all child tasks.

## Root scripts

| Script              | What it does                                             | Scope     |
| ------------------- | -------------------------------------------------------- | --------- |
| `pnpm dev`          | Persistent dev servers, no cache                         | all       |
| `pnpm build`        | Production builds                                        | web + api |
| `pnpm lint`         | `eslint` (Next), `expo lint`, `go vet`                   | all       |
| `pnpm check-types`  | `next typegen && tsc --noEmit`, `tsc --noEmit`, `go vet` | all       |
| `pnpm test`         | `go test ./...` (web/mobile have no tests yet)           | api       |
| `pnpm format`       | Prettier write over the repo                             | all files |
| `pnpm format:check` | Prettier check (CI-friendly)                             | all files |

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

## Ports

| Service         | Default URL             | How to change                                                |
| --------------- | ----------------------- | ------------------------------------------------------------ |
| API             | `http://localhost:8080` | `$env:PORT=9000; pnpm --filter @rose/apiRose dev`            |
| Web             | `http://localhost:3000` | `pnpm --filter @rose/webRose exec next dev -p 3001`          |
| Expo dev server | `http://localhost:8081` | `pnpm --filter @rose/mobileRose exec expo start --port 8082` |

## Caching

Turbo caches task outputs in `.turbo/` (local only). A cache hit replays logs instead of rerunning.

| Situation                | Command                                     |
| ------------------------ | ------------------------------------------- |
| Force a real rebuild     | `pnpm exec turbo run build --force`         |
| Inspect why a task ran   | `pnpm exec turbo run build --dry=json`      |
| Drop all local cache     | delete `.turbo/` and rerun                  |
| Prune stale global cache | `pnpm exec turbo prune --help` (scoped use) |

`build` inputs include `.env*` files, so changing an env file invalidates the build cache.

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

Env files are gitignored; commit `.env.example` when you need to share the variable list.

## Checklist

- [ ] You always run `pnpm install` from the root.
- [ ] You use `expo install` for Expo native packages.
- [ ] You know how to force a rebuild when the cache lies.

## Next step

Pick the app you're working on: [03-api.md](./03-api.md) · [04-web.md](./04-web.md) ·
[05-mobile.md](./05-mobile.md).
