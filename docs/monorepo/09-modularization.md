# Modular monolith by feature

Rose apps are modular monoliths: one deployable per app, organized by business capability instead of
technical layer. This document is the normative standard for where code lives, how modules depend on
one another, and how the rules are enforced.

> **Status: Accepted — effective immediately.** The bootstrap in section 12 is complete. This document
> is normative. If code and this document disagree, this document wins until both are updated.
>
> `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are used as defined in RFC 2119.

## Quick path

1. Read [the trees](#3-structure-trees) and [feature anatomy](#4-feature-anatomy).
2. Use [the decision matrix](#7-decision-matrix) to place new code.
3. Run `pnpm modularity`, then `pnpm verify` before opening a PR.
4. For an exception, update this document and `AGENTS.md` first; then implement it.

## 1. Definitions and the two-tier model

| Tier              | Where                                                                                      | What it is                                                         | Packaging                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| App-local module  | `src/features/<feature>`, `src/shared/<area>` in web and mobile; `internal/<domain>` in Go | A business capability or a reusable app concern, owned by one app. | **Not** a package: no `package.json`, no publishing, not resolved by pnpm. It is a logical boundary inside an app. |
| Workspace package | Root `packages/<name>`                                                                     | Code consumed by two or more apps: tokens, contracts, pure logic.  | A real pnpm/Turborepo package with `package.json`, a public entry point, and its own tests.                        |
| Composition root  | `webRose/src/app`, `mobileRose/src/app`, `apiRose/cmd/<binary>`                            | Wiring only: routes, providers, handlers, dependency construction. | Part of the app; never a home for business rules.                                                                  |

App-local modules are the default. A root package is an escalation, not a starting point.

### Promotion ladder

```text
feature-local code -> app shared -> root packages/*
```

Promotion MUST satisfy all three conditions:

1. Two or more **real** consumers exist today (not hypothetical).
2. The API is stable enough to name and test.
3. Tests cover the behavior, not just the happy path.

If a shared module drops to one consumer, move it back down. `YAGNI` applies to packages, tokens, and
contracts: do not create them before the second consumer exists.

## 2. Standard names and why

| Name                | Scope               | Why this name                                                                                                                   |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `features`          | Web and mobile apps | Names the unit by business capability. Ownership is obvious and features can grow or be deleted independently.                  |
| `shared`            | Web and mobile apps | Makes the boundary explicit: code here is reusable inside the app but is not a feature. It must not depend on features.         |
| `cmd/<binary>`      | Go                  | The Go convention for entrypoints. It keeps `main` small and makes additional binaries possible without restructuring.          |
| `internal/<domain>` | Go                  | Compiler-enforced privacy. Domains are packages; infrastructure is isolated from domain logic.                                  |
| `packages/*`        | Repository root     | A real workspace area. pnpm and Turborepo already understand it, so it must only hold real packages shared by two or more apps. |

### Why not other names

| Name                                | Verdict                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App-level `packages/`               | Rejected. It collides with the root `packages/*` workspace convention; a `package.json` there would create a package boundary and invite install/build/version semantics, while pnpm's workspace glob only covers the root.   |
| `modules/`                          | Rejected. Generic; it hides whether a folder is a capability, an adapter, or a utility.                                                                                                                                       |
| `domains/`                          | Rejected as a blanket name. Not every feature is a DDD domain, and the name invites tactical DDD ceremony the app does not need.                                                                                              |
| Top-level `components/`, `hooks/`   | Rejected as the primary structure. They organize by technical type and hide which capability owns the code.                                                                                                                   |
| Bulletproof React top-level folders | Valid alternative, not chosen. It groups by `features` plus root `components`, `hooks`, `lib`, `types`, and `config`. Rose uses `shared` so the app-local module boundary is explicit and only one word changes between apps. |

Technical-layer folders at the app `src` root (`components/`, `hooks/`, `constants/`, `lib/`) are
rejected by the checker. Reusable code belongs in `shared/<area>`; product code belongs in
`features/<feature>`.

## 3. Structure trees

Create only the folders a real feature needs. A README anchor is documentation, not a code layer.

### Web (`webRose`)

```text
webRose/
├── src/
│   ├── app/                     Next.js routes, layouts, composition root
│   ├── features/                business capabilities (app-local modules)
│   │   └── <feature>/
│   │       ├── api/             feature data access
│   │       ├── components/      feature UI
│   │       ├── hooks/           feature hooks
│   │       ├── model/           feature state, types, business rules
│   │       ├── lib/             feature-only helpers/adapters
│   │       ├── __tests__/       feature tests
│   │       └── index.ts         the only public entry point
│   ├── shared/                  reusable app code, no feature knowledge
│   │   ├── ui/                  design-system primitives
│   │   ├── lib/                 third-party adapters and infrastructure
│   │   ├── hooks/               generic hooks
│   │   ├── types/               cross-feature types
│   │   └── config/              app-wide configuration and constants
│   └── __tests__/               app-level tests that do not belong to a feature
├── next.config.ts
└── tsconfig.json
```

### Mobile (`mobileRose`)

```text
mobileRose/
├── src/
│   ├── app/                     expo-router routes, providers, composition root
│   ├── features/                business capabilities (app-local modules)
│   │   └── <feature>/           same anatomy as web
│   ├── shared/
│   │   ├── ui/                  themed-*, hint-row, app-tabs, animated-icon, external-link, web-badge, collapsible, future primitives
│   │   ├── theme/               theme tokens + color-scheme hooks
│   │   ├── hooks/               generic hooks (create when needed)
│   │   ├── lib/                 adapters (create when needed)
│   │   └── types/               cross-feature types (create when needed)
│   └── global.css               global styles
├── app.json
└── tsconfig.json
```

### API (`apiRose`)

```text
apiRose/
├── cmd/
│   └── server/
│       └── main.go              config, wiring, middleware, graceful shutdown
├── internal/
│   ├── <domain>/                domain packages (for example health)
│   └── platform/                config, logging, middleware, database, observability
├── go.mod
└── package.json                 Turborepo task wrapper only
```

### Repository root

```text
rose/
├── apiRose/
├── webRose/
├── mobileRose/
├── packages/                    real workspace packages only; README anchors the rule
└── docs/
```

There is no `packages/` inside an app. A module is not a package.

## 4. Feature anatomy

| Path          | Purpose                                         | Notes                                                                |
| ------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `api/`        | Requests, response mapping, feature data access | Uses the shared HTTP client; no UI code.                             |
| `components/` | Feature UI                                      | May use `shared/ui`; must not fetch directly.                        |
| `hooks/`      | Feature-specific hooks and orchestration        | Generic hooks belong in `shared/hooks`.                              |
| `model/`      | Types, state, validation, business rules        | The default home for feature knowledge.                              |
| `lib/`        | Feature-only helpers and adapters               | Promote to `shared/lib` only with a second consumer.                 |
| `__tests__/`  | Feature tests                                   | Tests live with the code they verify.                                |
| `index.ts`    | Public API                                      | The only file other modules may import. Export the smallest surface. |

Rules:

- Small features collapse layers. A three-file feature MAY keep everything in one folder with
  `index.ts`; do not create empty `api/`, `hooks/`, or `model/` folders.
- `index.tsx` is acceptable when the public API includes a component. Prefer `index.ts`.
- A feature folder that contains code MUST have `index.ts` or `index.tsx`.
- Do not export internals "just in case". Every export is a contract.

## 5. Dependency rules

### Web and mobile

```text
src/app  ->  src/features/<feature> (public index only)
src/app  ->  src/shared/*
src/features/<feature> -> src/shared/*
src/features/<feature> internal -> relative imports inside the same feature
src/shared/* -> other src/shared/* (alias or relative inside shared)
```

MUST:

- Import a feature only through `@/features/<feature>` or a relative path that resolves to its
  `index.ts`/`index.tsx`.
- Use `@/shared/*` for code shared between modules.
- Use relative imports inside the current feature or shared area.
- Keep `src/app` thin: routes resolve params, compose feature components, and wire providers.

MUST NOT:

- `shared` MUST NOT import `features` or `app`.
- A feature MUST NOT import another feature.
- A feature MUST NOT import `app`, including through `@/features/<self>`; use relative imports inside
  its own folder.
- No deep imports of feature internals from outside the feature.
- No relative import may escape its module boundary or the app root. No cross-app imports.
- Do not create an app-level `package.json` or `packages/` directory.

`@/assets/*` in mobile is an app-level static asset exception: `shared` and features MAY reference
assets through the alias. It is not a code dependency.

### Go

- `cmd/<binary>` builds the dependency graph and owns process concerns. No business logic.
- `internal/<domain>` owns one domain each. Cross-domain calls go through exported domain APIs, not
  through another domain's internals.
- `internal/platform` is reserved for infrastructure: configuration, logging, middleware, database,
  observability. It MUST NOT contain domain rules and MUST NOT import a domain.
- Domains MAY import `internal/platform`; `platform` MUST NOT import domains.
- Do not add `packages/` to Go. `internal/` already enforces privacy at compile time.
- Keep tests next to the code as `*_test.go`.

### Root packages

- `packages/<name>` is a real package boundary. Its public entry point is its only API.
- Packages MUST depend on other packages, never on an app.
- Web and mobile consume a package through its package name (for example `@rose/tokens`), not a
  relative path into `packages/`.
- A root package is created only after the promotion criteria in section 1 are met.

## 6. Principles and how they apply

| Principle                    | Rose interpretation                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Single Responsibility (SRP)  | One feature owns one business capability. One file owns one reason to change.                                            |
| Open/Closed (OCP)            | Extend features through composition and public props, not by editing shared branches for every caller.                   |
| Liskov Substitution (LSP)    | Public APIs and props behave predictably; a variant must not require callers to special-case it.                         |
| Interface Segregation (ISP)  | Narrow props and small ports. Do not pass a whole feature object when a caller needs two fields.                         |
| Dependency Inversion (DIP)   | Features depend on ports/adapters and props/context. No DI container is required or imposed.                             |
| Clean Code                   | Small functions, early returns, explicit names, errors handled at boundaries.                                            |
| KISS                         | The smallest structure that solves today's problem. No speculative layers, base classes, or generic frameworks.          |
| DRY with judgment (AHA)      | Duplicate accidental code until the pattern stabilizes. Unify business knowledge, invariants, and validated rules early. |
| Rule of three                | Abstract on the third real repetition, not the first imagined one.                                                       |
| YAGNI                        | No packages, tokens, contracts, state libraries, or abstractions before a real consumer exists.                          |
| Separation of Concerns (SoC) | UI, data access, state, and business rules have separate homes inside the feature.                                       |
| Composition over inheritance | Prefer small components, hooks, and adapters over deep class hierarchies.                                                |

Explicitly out: six-layer Feature-Sliced Design, Redux by default, generic base classes, and a
mandatory DI container.

## 7. Decision matrix

| If the code is...                          | Put it in...                                       |
| ------------------------------------------ | -------------------------------------------------- |
| A feature use case or business rule        | `features/<name>/model` or `features/<name>/hooks` |
| Feature UI                                 | `features/<name>/components`                       |
| A reusable primitive                       | `shared/ui`                                        |
| A third-party adapter or infrastructure    | `shared/lib`                                       |
| A generic hook                             | `shared/hooks`                                     |
| A type used by multiple features           | `shared/types`                                     |
| App-wide configuration or constants        | `shared/config`                                    |
| A type used by one feature                 | that feature's `model`                             |
| A design token shared by web and mobile    | `packages/tokens`                                  |
| An API contract shared by two or more apps | `packages/contracts`                               |
| Pure logic shared by two or more apps      | `packages/shared`                                  |
| A Go domain rule                           | `internal/<domain>`                                |
| Go infrastructure                          | `internal/platform`                                |
| App wiring, routes, providers              | `app/` (web/mobile) or `cmd/<binary>` (Go)         |

When two rows seem plausible, choose the lower tier. Promotion is a later, evidence-based decision.

## 8. Cross-app sharing

Root `packages/*` exists for exactly three kinds of code:

1. **Tokens** that must stay visually consistent across web and mobile (for example `@rose/tokens`).
2. **Contracts** that describe an API shared by two or more apps (for example `@rose/contracts`).
3. **Pure logic** with no platform, DOM, React Native, or UI dependency (for example `@rose/shared`).

Hard rules:

- No cross-platform UI. Web and mobile render differently; sharing components would couple two design
  systems and platform runtimes. Share tokens and logic, not screens.
- A root package MUST have two or more real consumers, a stable API, and tests.
- Web: add the package to `transpilePackages` in `webRose/next.config.ts` if Next.js must transpile its
  TypeScript sources.
- Mobile: depend on the package with `workspace:*`; Metro resolves workspace packages in this setup.
- If a package loses a consumer, move the code back to the surviving app's `shared` and delete the
  package. Do not keep a package alive for symmetry.

## 9. State, data, and errors

- **State ladder:** local component state -> feature state (`features/<name>/model` or hooks) -> app
  state only when multiple features genuinely share it. No global state library is imposed or
  expected by default.
- **Data access:** fetch in the feature's `api` module. A shared HTTP client lives in `shared/lib`.
  Components do not fetch directly; hooks/model call `api`.
- **Web:** prefer Server Components and server-side fetching. Put `"use client"` at the leaves that
  need state, effects, or event handlers, not at the top of a route.
- **Mobile:** hooks and context are enough for feature and app state. Do not add Redux by default.
- **Errors:** handle failures at boundaries (route handler, server action, data-access adapter, hook).
  Map infrastructure errors into UI-safe domain errors. Do not leak HTTP, database, or vendor errors
  into components.
- **Dependency inversion:** pass ports/adapters through props or context. Use a small interface at the
  boundary instead of importing infrastructure inside UI or domain code.

## 10. Enforcement

The standard is deterministic, not aspirational. No new dependencies were added to enforce it.

| Rule                                                     | Enforced by                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Module shape, package.json, `packages/`, feature indexes | `pnpm modularity` (`docs/scripts/modularity.mjs`)                                                 |
| Import direction and deep-import bans                    | `pnpm modularity` plus ESLint `no-restricted-imports` in each app                                 |
| Go domain privacy and `platform` direction               | The Go compiler enforces `internal/` privacy; `pnpm modularity` enforces the `platform` direction |
| Root package boundaries                                  | pnpm/Turborepo package resolution                                                                 |
| No bypass in CI                                          | `pnpm verify` and the `js` CI job                                                                 |

`pnpm modularity` checks:

1. No `package.json` under `<app>/src/features` or `<app>/src/shared`.
2. No directory named `packages` under any app `src`.
3. Direct child directories of `<app>/src` must be `app`, `features`, `shared`, `__tests__`, `e2e`, or
   `assets`; any other area is rejected.
4. A feature folder that contains code has `index.ts` or `index.tsx`.
5. `shared` does not import `@/features/*` or `@/app/*`; its relative imports stay inside `src/shared`.
6. A feature does not import `@/app/*` or `@/features/*`; its relative imports stay inside that feature.
7. `app` imports features only through the public index; deep feature imports and relative imports into
   feature internals are rejected.
8. No app file uses a relative import that escapes the app root.
9. No file under `apiRose/internal/platform` imports a domain package; only `internal/platform` and
   its subpackages are allowed.

Use `pnpm modularity` for humans and `node docs/scripts/modularity.mjs --json` for agents. The JSON
payload is `{ ok, violations: [{ file, line, rule, message }] }`.

ESLint zones:

- `src/shared/**`: forbid `@/features/*` and `@/app/*`.
- `src/features/**`: forbid `@/app/*` and `@/features/*`; use relative imports inside the feature.
- `src/app/**`: forbid `@/features/*/*`; import a feature through `@/features/<name>` only.

The script parser is intentionally simple: it scans static `import`/`export ... from`, side-effect
imports, dynamic `import()`, and `require()` in `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs` files.
It skips generated and build directories. It is a boundary check, not a type checker; TypeScript and
the framework resolve the rest.

## 11. Working with the standard

### Agent obligations (MUST)

- Read this document before any structural change: new feature, new shared area, new package, moving
  files, or changing imports.
- Use the existing structure. Do not invent a parallel folder convention.
- Run `pnpm modularity` after structural changes and `pnpm verify` before proposing a PR.
- Never create an app-level `package.json` or `packages/` directory.
- Never import feature internals or another feature.
- Never weaken enforcement to make a change pass.
- Update this document and `AGENTS.md` first when an exception is genuinely required.

### Human quickstart

1. Find the capability you are changing. If it does not exist, create `src/features/<name>/index.ts`
   and only the subfolders you need.
2. Put reusable primitives in `src/shared/ui`, adapters in `src/shared/lib`, generic hooks in
   `src/shared/hooks`.
3. Run `pnpm modularity` to validate the shape and imports.
4. Run `pnpm verify` before review.
5. If two apps genuinely need the same tokens, contracts, or pure logic, follow section 8 before
   creating a root package.

## 12. Bootstrap (completed now)

This was a **one-time bootstrap, not a phased adoption**. It is complete in this change. After this
change, every new line of code MUST follow the standard immediately. There is no "later" phase.

Artifacts created or migrated:

| Artifact                                                                                                                                                                                       | What changed                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `docs/monorepo/09-modularization.md`                                                                                                                                                           | This normative document.                                                                                  |
| `AGENTS.md`                                                                                                                                                                                    | Added the concise `Modularization (MUST)` section.                                                        |
| `webRose/src/features/README.md`, `webRose/src/shared/README.md`                                                                                                                               | Structure anchors for web.                                                                                |
| `mobileRose/src/features/README.md`, `mobileRose/src/shared/README.md`                                                                                                                         | Structure anchors for mobile.                                                                             |
| `apiRose/internal/README.md`, `apiRose/internal/platform/README.md`                                                                                                                            | Domain and platform anchors for Go.                                                                       |
| `packages/README.md`                                                                                                                                                                           | Root package rules and promotion criteria.                                                                |
| `mobileRose/src/shared/ui/themed-text.tsx`, `themed-view.tsx`, `hint-row.tsx`                                                                                                                  | Moved from `src/components`; behavior unchanged.                                                          |
| `mobileRose/src/shared/ui/animated-icon.tsx`, `animated-icon.web.tsx`, `animated-icon.module.css`, `app-tabs.tsx`, `app-tabs.web.tsx`, `external-link.tsx`, `web-badge.tsx`, `collapsible.tsx` | Moved from `src/components`; platform suffixes and the CSS module preserved; `src/components` removed.    |
| `mobileRose/src/shared/theme/theme.ts`, `use-theme.ts`, `use-color-scheme.ts`, `use-color-scheme.web.ts`                                                                                       | Moved from `src/constants` and `src/hooks`; imports updated.                                              |
| `mobileRose/src/shared/ui/__tests__/themed-text.test.tsx`                                                                                                                                      | Moved from `src/__tests__`; import updated.                                                               |
| `docs/scripts/modularity.mjs`                                                                                                                                                                  | Deterministic boundary checker with human and `--json` output, including the Go platform direction.       |
| Root `package.json`                                                                                                                                                                            | Added `pnpm modularity` and inserted it into `verify`.                                                    |
| `.github/workflows/ci.yml`                                                                                                                                                                     | Added the modularity gate to the `js` job.                                                                |
| `eslint.modularity.cjs`, `webRose/eslint.config.mjs`, `mobileRose/eslint.config.js`                                                                                                            | Shared built-in `no-restricted-imports` zones imported by both apps; no new plugins.                      |
| `docs/monorepo/README.md`, `01-structure.md`, `02-commands.md`, `03-api.md`, `04-web.md`, `05-mobile.md`, `06-troubleshooting.md`, `docs/scripts/README.md`                                    | Indexed the standard and updated structure, commands, API, web, mobile, troubleshooting, and script docs. |

The previous phased/optional adoption plan is superseded and MUST NOT be reintroduced.

## 13. Alternatives and verdict

| Alternative                                 | Verdict                    | Why                                                                                                                      |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Feature-Sliced Design (six layers)          | Rejected                   | Too much ceremony for current app size; the layer rules and cross-import constraints are heavier than the problem.       |
| Bulletproof React top-level folders         | Valid, not chosen          | A sound model, but `shared` makes the app-local module boundary explicit and keeps one vocabulary across web and mobile. |
| `modules/` by capability                    | Rejected                   | Generic name; it does not distinguish a feature from an adapter or utility.                                              |
| App-level `packages/`                       | Rejected                   | pnpm and Turborepo treat packages as install/build boundaries. A feature module is not a package.                        |
| Layer-based structure (`components`, `lib`) | Rejected as the structure  | It scales UI code but hides capability ownership and makes deletion risky.                                               |
| Tactical DDD in every feature               | Rejected as a blanket rule | Useful for genuinely complex domains; mandatory aggregates/entities would add ceremony to simple features.               |
| Micro-frontends                             | Rejected                   | One deployable per app is the current requirement; runtime composition adds cost with no consumer.                       |
| Cross-platform UI package                   | Rejected                   | Web and mobile have different design systems and runtimes. Share tokens and pure logic only.                             |
| One package per feature                     | Rejected                   | Creates package/install/version overhead for internal boundaries and invites accidental publishing.                      |

## 14. Risks and mitigations

| Risk                                      | Mitigation                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Boundary drift as features grow           | `pnpm modularity`, ESLint zones, and review; fix violations immediately instead of adding exceptions. |
| Premature abstraction or package creation | Promotion ladder, two-real-consumer rule, YAGNI, and demotion when a consumer disappears.             |
| Over-fragmentation inside a feature       | Collapse layers for small features; never create empty folders; rule of three before extracting.      |
| Circular dependencies across features     | No cross-feature imports; move shared knowledge down to `shared` or compose features in `app`.        |
| Enforcement bypass                        | `pnpm verify`, CI, and the explicit rule that enforcement MUST NOT be weakened to pass a change.      |
| Technical-layer folders under `src`       | The checker rejects unexpected src areas; use `shared/<area>` or `features/<feature>`.                |
| Go package sprawl                         | One package per real domain; `internal/platform` cannot import domains and the checker enforces it.   |
| Accidental app-level package              | The script rejects `package.json` and `packages/` under app `src`; README anchors repeat the rule.    |

## 15. Success criteria

Verified during the bootstrap by `pnpm modularity`, `pnpm docs:check`, and `pnpm verify`.

- [x] `pnpm modularity` passes with zero violations.
- [x] No app has `package.json` or `packages/` under `src`.
- [x] No app has an unexpected `src` area such as `components/`, `hooks/`, or `constants/`.
- [x] Every feature that contains code exposes `index.ts` or `index.tsx`.
- [x] No `shared` imports `features`/`app`; no feature imports another feature or `app`.
- [x] No feature internals are imported from outside the feature.
- [x] Go domain code lives in `internal/<domain>`; infrastructure lives in `internal/platform`.
- [x] No root package exists without two real consumers and tests.
- [x] No cross-platform UI is shared.
- [x] `AGENTS.md` and this document agree.
- [x] `pnpm verify` passes.

## 16. Non-goals

- Do not restructure the monorepo or move apps to `apps/`.
- Do not create app-level `packages/` or `package.json` files.
- Do not share UI between web and mobile.
- Do not impose a state or dependency-injection library.
- Do not create empty code layers or speculative features.
- Do not create root packages until two or more consumers exist.
- Do not bypass enforcement.
- Exceptions require updating this document and `AGENTS.md` first.

## 17. Decision record

| Field        | Decision                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Status       | **Accepted — effective immediately.**                                                                                    |
| Scope        | `webRose`, `mobileRose`, `apiRose`, and root `packages/*`.                                                               |
| Standard     | Modular monolith by feature: `features`/`shared` per app, `cmd`/`internal` in Go, root packages only for cross-app code. |
| Enforcement  | Active: `pnpm modularity`, ESLint zones, CI, Go `internal/`, and package boundaries.                                     |
| Exceptions   | Require updating this document and `AGENTS.md` before the code change.                                                   |
| Bootstrap    | Complete in this change; the phased plan is superseded.                                                                  |
| Precedence   | This document is normative. Code and document disagree: the document wins until both are updated.                        |
| Dependencies | No new dependencies and no lockfile changes were introduced by this standard.                                            |

## 18. Change control

This document is the source of truth for module structure. Any change to the standard MUST update this
document and the modularization section of `AGENTS.md` in the same change. CI and `pnpm verify` are the
final gate; a violation is fixed in code, not waived in the checker.

## Next step

Read [01-structure.md](./01-structure.md) for the repository map, then
[02-commands.md](./02-commands.md) for the daily command set.
