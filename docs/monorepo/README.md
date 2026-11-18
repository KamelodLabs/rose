# Rose monorepo

One repository, three applications, one install, one task graph. This documentation explains how the
workspace is wired and how to use it end to end without guessing.

## Quick path

1. `pnpm install` from the repo root (never inside a project).
2. `pnpm dev` to start all three apps in parallel.
3. Verify: API `http://localhost:8080/health`, web `http://localhost:3000`, Expo dev server on
   `http://localhost:8081`.

## What is inside

| Path          | Project             | Stack                                       | Package            |
| ------------- | ------------------- | ------------------------------------------- | ------------------ |
| `apiRose/`    | HTTP API            | Go 1.26, `net/http` stdlib                  | `@rose/apiRose`    |
| `webRose/`    | Web app             | Next.js 16, React 19, Tailwind 4            | `@rose/webRose`    |
| `mobileRose/` | Mobile app          | Expo SDK 58, expo-router, React Native 0.88 | `@rose/mobileRose` |
| `packages/*`  | Shared code (later) | TypeScript                                  | reserved glob      |

## Documentation map

| Doc                                              | Read it when you want to...                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| [01-structure.md](./01-structure.md)             | Understand why the repo looks the way it does        |
| [02-commands.md](./02-commands.md)               | Run, filter, build, cache, and add dependencies      |
| [03-api.md](./03-api.md)                         | Work on the Go API                                   |
| [04-web.md](./04-web.md)                         | Work on the Next.js web app                          |
| [05-mobile.md](./05-mobile.md)                   | Work on the Expo mobile app                          |
| [06-troubleshooting.md](./06-troubleshooting.md) | Fix a broken install, port, cache, or resolve error  |
| [07-branching.md](./07-branching.md)             | Understand `dev` -> `staging` -> `main` and releases |

## Ground rules

- **Install from the root only.** One lockfile (`pnpm-lock.yaml`), one `node_modules` layout.
- **Add dependencies with a filter** so they land in the right `package.json`.
- **Never edit `node_modules` or the lockfile by hand.**
- **Node >= 22 and pnpm 10.33.4** are pinned in `package.json` (`engines`, `packageManager`).
- **Windows first:** the API build emits `bin/server.exe`. See [03-api.md](./03-api.md) to port it.

## Next step

New here? Read [01-structure.md](./01-structure.md), then [02-commands.md](./02-commands.md). You will
know 90% of the workflow after those two.
