# Rose monorepo

pnpm + Turborepo monorepo. `apiRose` (Go 1.26), `webRose` (Next 16 + React 19), `mobileRose`
(Expo SDK 58 / React Native 0.88). Node 24, pnpm 10. Docs: `docs/monorepo/`.

## Commands (from the repo root)

```powershell
pnpm install            # also installs Husky hooks
pnpm verify             # format + lint + types + tests + quality + docs + build
pnpm dev:start          # api, web and mobile in the background
pnpm dev:status         # ports, URLs, PIDs and health
pnpm dev:stop
pnpm dev                # foreground dev (human)
pnpm test               # Vitest + Jest + go test
pnpm lint               # ESLint + expo lint + go vet
pnpm check-types        # tsc + go vet
pnpm quality            # jscpd + knip
pnpm doctor:repo        # toolchain, ports, metadata, git state (pnpm doctor is pnpm's built-in)
pnpm clean              # dry-run; node docs/scripts/clean.mjs --yes deletes caches
pnpm promote <name>     # dry-run; --yes promotes, pauses for review (status: promote:status)
```

Agent-friendly JSON (prefer these over parsing human output):

```powershell
node docs/scripts/dev.mjs start --json
node docs/scripts/dev.mjs status --json
node docs/scripts/dev.mjs stop --json
node docs/scripts/doctor.mjs --json
node docs/scripts/clean.mjs --json
node docs/scripts/promote.mjs <name> --json
```

More utilities:

```powershell
pnpm repo:status         # branch, diff, services, PR and checks
pnpm review:prep         # self-review before commit
pnpm ci:inspect [pr]     # failing checks and logs
pnpm ci:watch [pr]       # watch checks; no static timeout
pnpm pr:open             # dry-run; --yes pushes and opens a PR to dev
pnpm pr:review [pr]      # review summary or --approve/--comment/--request-changes
pnpm pr:merge [pr]       # review-gated merge; dry-run unless --yes
pnpm affected            # changed packages + suggested commands
pnpm guard               # secrets, generated files and large files
pnpm worktree:new <name> # isolated worktree under ../rose-worktrees
pnpm sync                # dry-run; --yes fast-forwards long-lived branches
pnpm expo:url / expo:qr  # Expo Go URL / QR image
pnpm deps:check          # outdated pnpm/Expo/Go (read-only)
pnpm release <vX.Y.Z>    # dry-run; --yes tags and pushes
pnpm docs:check          # links, placement, AGENTS, lockfile and tests
```

## Repo map

| Path                 | What it is                                                |
| -------------------- | --------------------------------------------------------- |
| `apiRose/`           | Go API; `GET /health`; tests in `internal/health`         |
| `webRose/`           | Next App Router under `src/app`; Vitest + Testing Library |
| `mobileRose/`        | Expo Router under `src/app`; Jest + RNTL                  |
| `docs/monorepo/`     | Human docs; read the relevant file before guessing        |
| `docs/scripts/`      | Deterministic dev utilities; see its `README.md`          |
| `.github/workflows/` | CI (`js`, `go`) and image builds                          |

## Modularization (MUST)

Read `docs/monorepo/09-modularization.md` before structural work; it is normative.

- Apps are modular monoliths: business code in `src/features/<feature>`, reusable app code in `src/shared/<area>`; Go uses `cmd/<binary>` + `internal/<domain>` + `internal/platform`.
- Direction: `app -> features -> shared`; `app -> shared` is allowed. `shared` MUST NOT import `features` or `app`; a feature MUST NOT import another feature.
- Import a feature only through its public `index.ts`/`index.tsx`; no deep imports. Use `@/shared/*` across modules and relative imports inside a module.
- An app-local module is not a package: never add `package.json` or `packages/` inside an app. Root `packages/*` is only for code used by 2+ apps; never share UI across web and mobile.
- Do not create technical-layer folders under `src` (`components/`, `hooks/`, `constants/`); reusable code goes in `src/shared/<area>`, product code in `src/features/<feature>`.
- Run `pnpm modularity` (or `node docs/scripts/modularity.mjs --json`) after structural changes; `pnpm verify` must pass.
- Exceptions require updating `docs/monorepo/09-modularization.md` and this file first. If code and doc disagree, the doc wins.

## Dev services and state

`pnpm dev:start` starts API, web and mobile detached. It writes `.dev/services.json` with each
service's `pid`, `port`, `url`, `health`, `log` and `status`, plus logs in `.dev/logs/`.

- **Never hardcode ports.** Web starts at 3000, API at 8080, mobile at 8081, but each picks the next free port. Read the JSON.
- Mobile also writes `mobileRose/.expo/rose-dev.json` (`expoGoUrl`, `host`, `port`, `qrPath`, `status`) and `mobileRose/.expo/expo-go-qr.png`.
- **Agents must relay `expoGoUrl`.** The human usually cannot see the terminal or QR. They can open the QR PNG or use Expo Go -> "Enter URL manually".
- Expo Go: same Wi-Fi -> `start`; different network -> `start:tunnel` (slower); Android emulator/USB -> `start:localhost` (Expo runs `adb reverse`). Expo Go must match SDK 58.
- `pnpm dev` is foreground; use `pnpm dev:start` when an agent must keep working. Stop with `pnpm dev:stop`, not manual `taskkill`.

## Testing

- Full suite: `pnpm test`. CI runs the same plus `go test -race` and both image builds.
- One app: `pnpm --filter @rose/webRose test`, `... @rose/mobileRose test`, `... @rose/apiRose test`.
- One Vitest test: `pnpm --filter @rose/webRose exec vitest run -t "<name>"`.
- One Go package: `pnpm --filter @rose/apiRose exec go test ./internal/health -run <Name>`.
- Add or update tests for every behavior change. For UI work, verify the app actually renders.

## Quality and generated files

- ESLint: `complexity 10`, `max-depth 4`, `max-params 4`, `max-lines-per-function 80 (.ts) / 150 (.tsx)`, `no-warning-comments`; tests are exempt from complexity and function length.
- Go: `gocyclo` fails above complexity 10 (`pnpm --filter @rose/apiRose lint:complexity`).
- knip fails on any unused file/dependency; jscpd fails above 7% duplication.
- Markdown lives under `docs/` or is a README; exactly one root `AGENTS.md`; no `CLAUDE.md`.
- Keep one `pnpm-lock.yaml`; JS/TS tests under `__tests__/` (or `e2e/`), Go `_test.go` under `apiRose/`.
- **Never commit generated files:** `.atl/`, `expo-env.d.ts`, `.expo/`, `.dev/`, `.cache/`, `.next/`,
  `.turbo/`, `bin/`, `coverage/`, `*.tsbuildinfo`. `expo-env.d.ts` is regenerated by Expo; types come
  from `expo/types`.
- **Never commit secrets or `.env` files.** Only `.env.example` is allowed.

## Git and pull requests

- Branch from `dev`: `feat/*`, `fix/*`, `chore/*`. Commit messages use conventional commits (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`).
- Hooks: `pre-commit` runs Prettier on staged files; `commit-msg` runs commitlint. `--no-verify` is a
  local escape hatch, not a workflow.
- PRs target `dev` and are squash-merged. Every PR requires review; before opening: `pnpm verify`.
- A non-author approval is required. Maintainers may self-review with `--self-reviewed`; `promote` pauses at each review gate and resumes with `--resume` (add `--self-reviewed` after self-review). Branch protection on `dev` is the real enforcement.
- Promotions `dev -> staging -> main` go through `node docs/scripts/promote.mjs <name> --yes` (or the documented `promote/<name>` hybrid branch). **Never** push or merge directly to `dev`, `staging` or `main`.
- **Never** force-push, rewrite history, or bypass branch protection. Check with
  `gh pr checks <n> --watch --fail-fast`.

## Boundaries

**Always:** read `.dev/services.json` / `.expo/rose-dev.json` for state; run `pnpm verify` before a PR; update docs and tests with behavior changes; keep changes inside the request.

**Ask first:** adding dependencies; changing the database schema or public API; deleting data or
rewriting git history; touching deployment, secrets or production; broad refactors.

**Never:** commit secrets; push to protected branches; force-push; edit generated files; run
production migrations; invent commands when `docs/scripts/` already covers the task.

## Working style

- **Think before coding.** State assumptions, surface tradeoffs, ask when the request is ambiguous.
- **Simplicity first.** Minimum code that solves the problem; no speculative abstractions.
- **Surgical changes.** Touch only what the task requires; do not refactor adjacent code.
- **Goal-driven execution.** Define success criteria, write or run the verification, loop until green.
  Skip the ceremony for trivial changes.

## Windows notes

- PowerShell 5.1 has no `&&`; use `;` or `if ($?) { ... }`.
- Git hooks run through Git Bash; if they fail, see `docs/monorepo/06-troubleshooting.md`.
- Use `pnpm dev:status` / `pnpm dev:stop` instead of hunting PIDs manually.
- Node version is pinned in `.node-version` (24); CI uses Node 24.

## More

- Human docs: `docs/monorepo/` (commands, API, web, mobile, branching, deployment).
- Script reference and safety: `docs/scripts/README.md`.
- CI is the final gate: `.github/workflows/ci.yml` (`js`, `go`).
