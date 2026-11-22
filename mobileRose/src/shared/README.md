# Mobile shared code

Reusable mobile code that belongs to no single feature.

- `shared/ui` owns every reusable primitive, including the starter shell primitives (`animated-icon`,
  `app-tabs`, `external-link`, `web-badge`, `collapsible`, `themed-*`, `hint-row`) and future ones.
- `shared/theme` owns tokens and color-scheme hooks; `shared/lib`, `shared/hooks`, and `shared/types`
  are created only when a real adapter, generic hook, or cross-feature type needs them.
- `src/components` no longer exists. Do not recreate it or other technical-layer folders at the `src`
  root (`components/`, `hooks/`, `constants/`).
- Shared code may import `@/shared/*`; it must not import `@/features/*` or `@/app/*`.
- `@/assets/*` is allowed for static assets.
- No `package.json` and no `packages/` here.

Standard: [09-modularization.md](../../../docs/monorepo/09-modularization.md).
