# Web shared code

Reusable web code that belongs to no single feature.

- `shared/ui` for design-system primitives, `shared/lib` for adapters, `shared/hooks` for generic hooks,
  `shared/types` for cross-feature types, `shared/config` for app-wide configuration. Create only the
  areas you need.
- Shared code may import `@/shared/*`; it must not import `@/features/*` or `@/app/*`.
- If a piece of shared code gains a second app consumer, follow the promotion ladder.
- No `package.json` and no `packages/` here.

Standard: [09-modularization.md](../../../docs/monorepo/09-modularization.md).
