# Mobile features

Business capabilities for the mobile app. Each feature is an app-local module, not a package.

- One folder per capability: `src/features/<feature>`.
- Export the public API from `index.ts` (or `index.tsx`); nothing else is importable from outside.
- Features may import `@/shared/*`; they must not import another feature or `@/app/*`.
- No `package.json` and no `packages/` here.

Standard: [09-modularization.md](../../../docs/monorepo/09-modularization.md).
