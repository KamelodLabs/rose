# Repository structure

The repo is a pnpm workspace orchestrated by Turborepo. The web and mobile apps are npm packages;
the Go API is wrapped in a tiny npm package so a single task graph covers all three.

## Quick path

1. Open `pnpm-workspace.yaml` — the three folders plus a reserved `packages/*` glob.
2. Open `turbo.json` — the task graph (`build`, `dev`, `lint`, `check-types`, `test`).
3. Open any project's `package.json` — the same script names everywhere.

## Tree

```text
rose/
├── package.json            root workspace: scripts delegate to turbo
├── pnpm-workspace.yaml     workspace members + nodeLinker + ignored build scripts
├── turbo.json              task graph and cache outputs
├── tsconfig.base.json      shared strict TypeScript baseline
├── .prettierrc.json        formatting (repo-wide)
├── .prettierignore
├── .editorconfig
├── .gitignore
├── pnpm-lock.yaml          single lockfile, single source of truth
├── apiRose/                Go module `rose/apiRose`
│   ├── cmd/server/         main entrypoint
│   ├── internal/           private Go packages (handlers, domain)
│   ├── go.mod
│   └── package.json        task wrapper -> go run/build/vet/test
├── webRose/                Next.js app
│   ├── src/app/            App Router routes
│   ├── public/
│   ├── next.config.ts
│   └── tsconfig.json       extends ../tsconfig.base.json
└── mobileRose/             Expo app
    ├── src/app/            expo-router file-based routes
    ├── src/components/     UI components
    ├── src/hooks/, src/constants/
    ├── assets/
    ├── app.json
    └── tsconfig.json       extends expo/tsconfig.base + ../tsconfig.base.json
```

## Why the Go API has a `package.json`

Turborepo only discovers npm workspace packages. `apiRose/package.json` translates the standard
script names into Go commands:

| Script        | Command                                   |
| ------------- | ----------------------------------------- |
| `dev`         | `go run ./cmd/server`                     |
| `build`       | `go build -o bin/server.exe ./cmd/server` |
| `lint`        | `go vet ./...`                            |
| `check-types` | `go vet ./...`                            |
| `test`        | `go test ./...`                           |

This keeps one entrypoint (`pnpm dev`, `pnpm build`, ...) for a polyglot repo without installing a
second task runner.

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
| Mobile screens         | `mobileRose/src/app/` (file name = route)      |
| Mobile shared UI       | `mobileRose/src/components/`                   |
| Cross-project TS types | `packages/*` (reserved, see below)             |

## Shared code (`packages/*`)

The glob is already in `pnpm-workspace.yaml`; the folder does not exist yet on purpose. When you create
`packages/shared`, two things matter:

1. **Next.js** does not transpile workspace TypeScript sources by default. Add
   `transpilePackages: ['@rose/shared']` to `webRose/next.config.ts`.
2. **Expo** resolves workspace packages through Metro automatically (SDK 52+), but keep the package
   dependency exact (`workspace:*`) so autolinking stays consistent.

## Checklist

- [ ] You can explain why `apiRose/package.json` exists.
- [ ] You know the root is the only place where `pnpm install` runs.
- [ ] You know `packages/*` is reserved, not active.

## Next step

Read [02-commands.md](./02-commands.md) for the daily command set.
