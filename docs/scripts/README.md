# Repo scripts

Small Node ESM utilities for the Rose monorepo. They use only Node built-ins and print deterministic
output. `--json` makes stdout machine-readable; progress and diagnostics go to stderr when JSON is
requested.

| Script    | Command                                                 | What it does                                                               |
| --------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dev.mjs` | `node docs/scripts/dev.mjs <start\|status\|stop\|logs>` | Starts, probes, stops, and tails detached dev services (api, web, mobile)  |
| `doctor`  | `node docs/scripts/doctor.mjs`                          | Checks Node/pnpm versions, tools, ports, dev state, Expo metadata, and git |
| `clean`   | `node docs/scripts/clean.mjs`                           | Lists (dry run) or removes generated caches                                |
| `promote` | `node docs/scripts/promote.mjs <name>`                  | Plans (dry run) or executes the dev -> staging -> main promotion           |

## Examples

```powershell
# Background services with a registry and per-service logs
pnpm dev:start                 # or: node docs/scripts/dev.mjs start
pnpm dev:start -- --json
pnpm dev:status -- --json
node docs/scripts/dev.mjs logs api --lines 5
pnpm dev:stop -- --json

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

| Script    | `--json` payload                                                                     |
| --------- | ------------------------------------------------------------------------------------ |
| `dev`     | The service registry (`startedAt`, `services`, `stoppedAt` after stop)               |
| `doctor`  | `{ ok, checkedAt, summary: { ok, warn, fail }, checks: [{ name, status, detail }] }` |
| `clean`   | `{ dryRun, refused, targets, totalBytes }` or `{ dryRun: false, deleted, failed }`   |
| `promote` | Dry run: `{ dryRun: true, name, branch, merge, prs, commits, steps }`                |

`dev.mjs logs` also accepts `--json` and returns the last lines of each log file.

## Safety

- `clean` and `promote` are **dry runs by default**. Nothing is deleted, pushed, or merged without
  `--yes`.
- `clean` refuses to run while `.dev/services.json` has live PIDs. Run `pnpm dev:stop` first.
- `promote --yes` verifies a clean tree on `dev`, requires `gh` authentication, fetches `origin`,
  refuses an empty `origin/main..origin/dev`, and stops at the first failing check with the PR URL
  and the exact next command. It never force-pushes and never pushes to a protected branch.
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
