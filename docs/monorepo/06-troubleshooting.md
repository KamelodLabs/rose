# Troubleshooting

Most failures in this repo fall into five buckets: install and hooks, ports, stale caches, tests, and
the quality/complexity gates. Start with the table, then use the reset recipes and the per-area
sections.

## Quick triage

| Symptom                                          | Cause                                                                                                                 | Fix                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Cannot find module 'expo-router/entry'`         | Dependencies not installed from the root                                                                              | `pnpm install` at the repo root                                                                 |
| Metro: `Unable to resolve module <x>`            | Stale Metro cache or an isolated node_modules layout                                                                  | `pnpm install`, then `pnpm --filter @rose/mobileRose exec expo start -c`                        |
| `Port 3000/8080/8081 already in use`             | Another process is listening                                                                                          | Change the port (see below) or kill the process                                                 |
| Turbo says cache hit but artifacts are missing   | Outputs deleted or glob mismatch                                                                                      | `pnpm exec turbo run build --force`                                                             |
| `next typegen` / `tsc` fails only in web         | `.next` missing or stale                                                                                              | `pnpm --filter @rose/webRose check-types` again; delete `webRose/.next` if needed               |
| `pnpm install` warns about ignored build scripts | `ignoredBuiltDependencies` in `pnpm-workspace.yaml` suppresses warnings for known packages (`sharp`, `unrs-resolver`) | A warning about another package means a new dependency needs approval via `pnpm approve-builds` |
| `go: cannot find main module`                    | Ran Go from the wrong folder                                                                                          | Run inside `apiRose/` or use the wrapper: `pnpm --filter @rose/apiRose build`                   |
| `Unsupported engine` / install aborts            | `.npmrc` sets `engine-strict=true`; Node is older than 22                                                             | `node -v`, switch with nvm/fnm to >= 22                                                         |
| `husky` fails during `pnpm install`              | Not a Git checkout, or the hook setup is broken                                                                       | Clone the repo properly; the web image build sets `HUSKY=0` on purpose                          |
| Commit rejected: `type must be one of [...]`     | commitlint only allows 11 Conventional types                                                                          | Use an allowed type, or `git commit --no-verify` (local bypass)                                 |
| `pnpm quality` fails on knip                     | A new unused file or dependency exists                                                                                | Remove it, or declare the entry in `knip.json`                                                  |
| jscpd exceeds the threshold                      | Duplicated code is above 7%                                                                                           | Extract the shared code instead of raising the threshold                                        |
| ESLint `complexity` / `max-depth` error          | A function is too complex                                                                                             | Extract helpers; config lives in the app's ESLint file                                          |
| gocyclo reports a function above 10              | A Go function is too complex                                                                                          | Split it; run `pnpm --filter @rose/apiRose lint:complexity`                                     |
| Vitest cannot resolve `@/...`                    | Alias missing, or the test ran outside the package                                                                    | Run `pnpm --filter @rose/webRose test`; check `vitest.config.mts`                               |
| `next/image` fails under jsdom                   | No image optimizer in jsdom                                                                                           | Mock `next/image` as in `home.test.tsx`                                                         |
| Jest cannot find a `.css` module                 | CSS import not mapped                                                                                                 | `moduleNameMapper` sends `\.css$` to `test/style-mock.js`                                       |
| Jest cannot resolve `@/...`                      | Alias not mapped                                                                                                      | `moduleNameMapper` maps `^@/(.*)$` to `<rootDir>/src/$1`                                        |
| Commands fail with `&&` in PowerShell            | PowerShell 5.1 has no `&&`                                                                                            | Use `;` or `if ($?) { ... }`                                                                    |
| Expo Go shows a version mismatch                 | App SDK and Expo Go client differ                                                                                     | Update Expo Go, or build a dev client                                                           |
| Phone cannot reach Expo Go                       | Wrong host, virtual adapter, firewall, or SDK mismatch                                                                | See [Phone cannot connect to Expo Go](#phone-cannot-connect-to-expo-go)                         |
| `ERR_PNPM_OUTDATED_LOCKFILE` in CI               | `package.json` changed without committing lockfile                                                                    | Run `pnpm install` locally and commit `pnpm-lock.yaml`                                          |

## Free a port

```powershell
# What is listening?
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID> -Force

# Or move the service
pnpm --filter @rose/webRose exec next dev -p 3001
$env:PORT=9000; pnpm --filter @rose/apiRose dev
pnpm --filter @rose/mobileRose exec expo start --port 8082
```

## Phone cannot connect to Expo Go

Work through this checklist in order; most failures are the wrong host or a blocked port.

1. **Same network.** Phone and computer must be on the same Wi-Fi/VLAN. Guest Wi-Fi and client
   isolation block the connection.
2. **Use the metadata URL.** Start with `pnpm --filter @rose/mobileRose start`, then read
   `mobileRose/.expo/rose-dev.json` and open its `expoGoUrl` (or scan `.expo/expo-go-qr.png`). Do not
   guess the IP from `ipconfig`.
3. **Virtual adapters.** Hyper-V, VMware, WSL, Docker, and VPN adapters are ignored by the wrapper. If
   the printed host is still wrong, set `$env:EXPO_LAN_HOST='192.168.1.7'` and restart.
4. **Firewall.** Allow Node/Metro on the chosen port (8081 by default) for **Private** networks. A
   blocked inbound rule makes `/status` fail from the phone even when `localhost` works.
5. **Port fallback.** The wrapper uses 8082, 8083, ... when 8081 is busy. Trust the port in
   `rose-dev.json`, not the default.
6. **Expo Go SDK.** Expo Go supports one SDK per build; this project is SDK 58. Install the matching
   client from <https://expo.dev/go> or run `pnpm dlx expo-go download android 58`.
7. **Tunnel fallback.** On different networks or locked-down Wi-Fi, use
   `pnpm --filter @rose/mobileRose start:tunnel` (slower; may install `@expo/ngrok`). The tunnel URL is
   printed in the terminal and is not written to `rose-dev.json`.
8. **QR visibility and CI.** The QR only renders in an interactive Expo terminal. Press `E` to reprint
   it; `CI=1` disables it. If nobody sees the terminal, relay `expoGoUrl` instead of the QR.

## Test failures

Web (Vitest + jsdom):

- `Failed to resolve import "@/..."` means the alias did not load. Run the test through the package
  script so `vitest.config.mts` is picked up: `pnpm --filter @rose/webRose test`.
- `next/image` needs a mock because jsdom has no image optimizer. Follow the stub in
  `webRose/src/__tests__/home.test.tsx`.

Mobile (Jest + `jest-expo`):

- `Cannot find module './something.css'` means the CSS mapper is missing. `mobileRose/package.json`
  maps `\.css$` to `test/style-mock.js`.
- `Cannot find module '@/...'` means the alias mapper is missing. It maps `^@/(.*)$` to
  `<rootDir>/src/$1`.
- Transform errors inside `node_modules` usually mean the `jest-expo` preset was overridden. Restore
  the preset and use its transforms.

Go:

- `go test -race ./...` requires cgo and a C toolchain. It runs on the Ubuntu CI runner; on Windows,
  `pnpm --filter @rose/apiRose test` (plain `go test`) needs no C toolchain.

## Quality gates

`pnpm quality` runs two gates in order:

- `pnpm quality:duplication` (jscpd) fails above the 7% threshold configured in `.jscpd.json`. Extract
  the shared code instead of relaxing the threshold.
- `pnpm quality:unused` (knip) uses `--include files,dependencies --max-issues 0`: **any** new unused
  file or dependency fails the gate. Remove it, or list an intentional entry point in `knip.json`.

Run `pnpm quality` before pushing; CI runs the same command.

## Complexity failures

- **Web/mobile (ESLint):** `webRose/eslint.config.mjs` and `mobileRose/eslint.config.js` enforce
  `complexity` max 10, `max-depth` max 4, `max-params` max 4, `max-lines-per-function` 80 (150 for
  `.tsx` files), and reject `TODO`/`FIXME`/`HACK` comments. Test files are exempt from `complexity`
  and `max-lines-per-function` only; `max-depth`, `max-params`, and `no-warning-comments` still apply.
  `no-warning-comments` only matches comments that start with the term (`location: 'start'`).
- **API (gocyclo):** `pnpm --filter @rose/apiRose lint:complexity` runs gocyclo v0.6.0 with
  `-over 10 -ignore _test.go`.

Each gate reports differently:

- ESLint: `Function 'handleRequest' has a complexity of 12. Maximum allowed is 10.`
- gocyclo: `<complexity> <package> <function> <file:line:column>`, for example
  `12 main handleRequest main.go:10:1`.

Extract branches into named helpers; do not suppress the rule.

## Hooks and commit messages

`pnpm install` runs `prepare` -> `husky`, which installs `.husky/pre-commit` and `.husky/commit-msg`.

- `pre-commit` runs `lint-staged` with Prettier only. If it rewrites files, review and re-stage them.
- `commit-msg` runs commitlint. Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `build`, `ci`, `chore`, `revert`.
- `git commit --no-verify` bypasses both hooks. Use it only as a deliberate local escape hatch.
- Commitlint is local only; CI does not validate commit messages.
- On Windows, hooks execute through Git Bash and need `node` and `pnpm` available there. If Git Bash
  cannot find them, fix the PATH rather than bypassing the hook.
- `webRose/Dockerfile` sets `HUSKY=0` because `.dockerignore` excludes `.git`; the `prepare` hook cannot
  run in a non-git context.

## Generated files

`.atl/`, `expo-env.d.ts`, and `.cache/` are generated and gitignored:

- `.atl/` — local tooling scratch/cache; delete it freely.
- `expo-env.d.ts` — generated by Expo; regenerate with any Expo command.
- `.cache/` — Prettier cache (local or CI); rebuilt on demand.
- `mobileRose/.expo/rose-dev.json` and `mobileRose/.expo/expo-go-qr.png` — connection metadata and QR
  image written by the mobile `start`/`dev` wrapper; recreated on every start.

If one appears untracked, leave it alone; it is not part of the repository.

## Reset recipes (least destructive first)

```powershell
# 1. Re-link dependencies, keep everything else
pnpm install

# 2. Force real task execution
pnpm exec turbo run build --force

# 3. Clear framework caches
Remove-Item -Recurse -Force .\webRose\.next -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\mobileRose\.expo -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\.turbo -ErrorAction SilentlyContinue

# 4. Hard reset node_modules (lockfile survives)
Remove-Item -Recurse -Force .\node_modules
pnpm install
```

Only delete `pnpm-lock.yaml` if you intentionally want a full re-resolution; commit the regenerated
lockfile immediately.

## Things that are intentional

| Behavior                                     | Why                                                            |
| -------------------------------------------- | -------------------------------------------------------------- |
| `mobileRose` has no `build` script           | Native builds go through EAS                                   |
| `apiRose` has no `start` script              | The binary is run directly or through `go run`                 |
| Root has no ESLint config                    | `eslint-config-next` and `eslint-config-expo` are incompatible |
| No pnpm catalogs for React/Expo              | Expo requires exact, SDK-matched versions                      |
| `apiRose` has a `package.json`               | It is the Turborepo bridge to Go commands                      |
| `nodeLinker: hoisted`                        | Required for a predictable Expo/Metro setup on pnpm            |
| `packages/*` listed but the folder is absent | Reserved for future shared code                                |

## Checklist

- [ ] `pnpm install` from the root fixes the majority of "module not found" errors.
- [ ] You restarted the dev server after changing config files.
- [ ] You can explain the difference between a Turbo cache hit and a real execution.
- [ ] You know hooks are local and can be bypassed, but should not be.

## Next step

Back to the index: [README.md](./README.md).
