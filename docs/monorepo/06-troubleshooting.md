# Troubleshooting

Most failures in this repo come from one of four things: installing in the wrong place, a port
conflict, a stale cache, or reasoning about pnpm's hoisted layout. Start with the table, then use the
reset recipes at the bottom.

## Quick triage

| Symptom                                          | Cause                                                | Fix                                                                               |
| ------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Cannot find module 'expo-router/entry'`         | Dependencies not installed from the root             | `pnpm install` at the repo root                                                   |
| Metro: `Unable to resolve module <x>`            | Stale Metro cache or an isolated node_modules layout | `pnpm install`, then `pnpm --filter @rose/mobileRose exec expo start -c`          |
| `Port 3000/8080/8081 already in use`             | Another process is listening                         | Change the port (see below) or kill the process                                   |
| Turbo says cache hit but artifacts are missing   | Outputs deleted or glob mismatch                     | `pnpm exec turbo run build --force`                                               |
| `next typegen` / `tsc` fails only in web         | `.next` missing or stale                             | `pnpm --filter @rose/webRose check-types` again; delete `webRose/.next` if needed |
| `pnpm install` warns about ignored build scripts | `ignoredBuiltDependencies` in `pnpm-workspace.yaml`  | Expected (`sharp`, `unrs-resolver`). For a new package: `pnpm approve-builds`     |
| `go: cannot find main module`                    | Ran Go from the wrong folder                         | Run inside `apiRose/` or use the wrapper: `pnpm --filter @rose/apiRose build`     |
| `Unsupported engine` / weird Node behavior       | Node older than 22                                   | `node -v`, switch with nvm/fnm to >= 22                                           |
| Commands fail with `&&` in PowerShell            | PowerShell 5.1 has no `&&`                           | Use `;` or `if ($?) { ... }`                                                      |
| Expo Go shows a version mismatch                 | App SDK and Expo Go client differ                    | Update Expo Go, or build a dev client                                             |
| `ERR_PNPM_OUTDATED_LOCKFILE` in CI               | `package.json` changed without committing lockfile   | Run `pnpm install` locally and commit `pnpm-lock.yaml`                            |

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
| Root has no ESLint config                    | `eslint-config-next` and `eslint-config-expo` are incompatible |
| No pnpm catalogs for React/Expo              | Expo requires exact, SDK-matched versions                      |
| `apiRose` has a `package.json`               | It is the Turborepo bridge to Go commands                      |
| `nodeLinker: hoisted`                        | Required for a predictable Expo/Metro setup on pnpm            |
| `packages/*` listed but the folder is absent | Reserved for future shared code                                |

## Checklist

- [ ] `pnpm install` from the root fixes the majority of "module not found" errors.
- [ ] You restarted the dev server after changing config files.
- [ ] You can explain the difference between a Turbo cache hit and a real execution.

## Next step

Back to the index: [README.md](./README.md).
