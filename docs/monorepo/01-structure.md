# Repository structure

The repo is a pnpm workspace orchestrated by Turborepo. The web and mobile apps are npm packages;
the Go API is wrapped in a tiny npm package so a single task graph covers all three.

## Quick path

1. Open `pnpm-workspace.yaml` — the three folders plus a reserved `packages/*` glob.
2. Open `turbo.json` — the task graph (`build`, `dev`, `lint`, `check-types`, `test`).
3. Open any project's `package.json` — task names line up through Turbo, but each app adds its own
   scripts (`start` only on web/mobile, `dev` on mobile too, `lint:complexity` only on the API).

## Tree

```text
rose/
├── package.json            root workspace: turbo tasks + direct format/quality/prepare scripts
├── pnpm-workspace.yaml     workspace members + nodeLinker + ignored build scripts
├── turbo.json              task graph and cache outputs
├── tsconfig.base.json      shared strict TypeScript baseline
├── .prettierrc.json        formatting (repo-wide)
├── .prettierignore
├── .editorconfig
├── .gitignore
├── .npmrc                  engine-strict=true (unsupported Node fails the install)
├── .jscpd.json             duplication gate (7% threshold)
├── knip.json               unused files/dependencies gate
├── commitlint.config.mjs   Conventional Commits + allowed types
├── .husky/
│   ├── pre-commit          lint-staged (Prettier on staged files)
│   └── commit-msg          commitlint
├── pnpm-lock.yaml          single lockfile, single source of truth
├── apiRose/                Go module `rose/apiRose`
│   ├── cmd/server/         main entrypoint
│   ├── internal/           private Go packages (handlers, domain)
│   ├── go.mod
│   └── package.json        task wrapper -> go run/build/vet/test/gocyclo
├── webRose/                Next.js app
│   ├── src/app/            App Router routes
│   ├── src/__tests__/      Vitest tests
│   ├── public/
│   ├── next.config.ts
│   ├── vitest.config.mts   jsdom + `@` alias
│   └── tsconfig.json       extends ../tsconfig.base.json
└── mobileRose/             Expo app
    ├── src/app/            expo-router file-based routes
    ├── src/components/     UI components
    ├── src/hooks/, src/constants/
    ├── src/__tests__/      Jest + React Native Testing Library tests
    ├── test/style-mock.js  CSS stub for Jest
    ├── assets/
    ├── app.json
    └── tsconfig.json       extends expo/tsconfig.base + ../tsconfig.base.json
```

## Why the Go API has a `package.json`

Turborepo only discovers npm workspace packages. `apiRose/package.json` translates the standard
script names into Go commands:

| Script            | Command                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `dev`             | `go run ./cmd/server`                                             |
| `build`           | `go build -o bin/server.exe ./cmd/server`                         |
| `lint`            | `go vet ./...`                                                    |
| `check-types`     | `go vet ./...`                                                    |
| `lint:complexity` | `go run github.com/fzipp/gocyclo/cmd/gocyclo@v0.6.0 -over 10 ...` |
| `test`            | `go test ./...`                                                   |

Root scripts are a mix: `dev`, `build`, `lint`, `check-types`, and `test` fan out through Turbo;
`format`, `format:check`, `prepare`, `quality`, `quality:duplication`, and `quality:unused` run
directly at the root.

This keeps a single task graph for a polyglot repo without installing a second task runner. `pnpm dev`
starts all three apps: web, API, and mobile (Expo). Mobile keeps both `dev` and `start` so you can run
it alone with `pnpm --filter @rose/mobileRose start`.

## Task names across apps

The shared names line up, but the apps are not identical:

| Task    | Root          | `webRose`                           | `mobileRose`         | `apiRose`             |
| ------- | ------------- | ----------------------------------- | -------------------- | --------------------- |
| `dev`   | turbo fan-out | `next dev`                          | `expo start`         | `go run ./cmd/server` |
| `start` | none          | `node scripts/start-standalone.mjs` | `expo start`         | none                  |
| `build` | turbo fan-out | `next build`                        | none (EAS builds it) | `go build`            |
| `test`  | turbo fan-out | `vitest run`                        | `jest`               | `go test ./...`       |
| `lint`  | turbo fan-out | `eslint`                            | `expo lint`          | `go vet ./...`        |

## Dependency graph

```text
webRose ──── build ──> (its own next build)
apiRose ──── build ──> (its own go build)
mobileRose ─ no build (compiled by EAS)
```

Turbo runs packages in parallel; `dependsOn: ["^build"]` means "build upstream workspace
dependencies first". Today the three apps have no cross dependencies, so they build independently.
Once you add `packages/shared`, consumers will build after it automatically.

## What lives where

| Kind of code           | Location                                       |
| ---------------------- | ---------------------------------------------- |
| Go HTTP handlers       | `apiRose/internal/<domain>/`                   |
| Go entrypoint / wiring | `apiRose/cmd/server/main.go`                   |
| Web pages and layouts  | `webRose/src/app/`                             |
| Web shared UI          | `webRose/src/components/` (create when needed) |
| Web tests              | `webRose/src/__tests__/`                       |
| Mobile screens         | `mobileRose/src/app/` (file name = route)      |
| Mobile shared UI       | `mobileRose/src/components/`                   |
| Mobile tests           | `mobileRose/src/__tests__/`                    |
| Cross-project TS types | `packages/*` (reserved, see below)             |

## Shared code (`packages/*`)

The glob is already in `pnpm-workspace.yaml`; the folder does not exist yet on purpose. When you create
`packages/shared`, two things matter:

1. **Next.js** does not transpile workspace TypeScript sources by default. Add
   `transpilePackages: ['@rose/shared']` to `webRose/next.config.ts`.
2. **Expo** resolves workspace packages through Metro automatically (SDK 52+), but keep the package
   dependency exact (`workspace:*`) so autolinking stays consistent.

## Generated files

Generated artifacts are gitignored and never committed:

| Path                                  | Generated by      | Notes                                                           |
| ------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `.atl/`                               | local tooling     | scratch/cache state                                             |
| `expo-env.d.ts`                       | Expo CLI          | included by `mobileRose/tsconfig.json`; types from `expo/types` |
| `.cache/`                             | Prettier cache    | recreated when needed                                           |
| `.turbo/`, `.next/`, `.expo/`, `bin/` | build/task output | recreated by the tool that owns it                              |

`expo-env.d.ts` is the one that trips people up: it is generated by Expo, ignored by Git, and the
actual type source is `expo/types`, configured in `mobileRose/tsconfig.json`. Do not commit it.

## Checklist

- [ ] You can explain why `apiRose/package.json` exists.
- [ ] You know the root is the only place where `pnpm install` runs.
- [ ] You know `packages/*` is reserved, not active.
- [ ] You know `pnpm dev` starts the web app, the API, and mobile.

## Next step

Read [02-commands.md](./02-commands.md) for the daily command set.
