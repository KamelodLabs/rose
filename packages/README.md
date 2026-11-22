# Workspace packages

Reserved for real pnpm/Turborepo packages shared by two or more apps.

Create `packages/<name>` only when all of these are true:

- Two or more apps consume the code today.
- The API is stable enough to name and test.
- Tests cover the behavior.
- The code is a token set, an API contract, or pure logic. Never cross-platform UI.

A package has a `package.json`, a public entry point, and its own tests. If a package drops to one
consumer, move the code back to that app's `shared` area.

App-local modules are not packages. Never create `packages/` inside an app.

Standard: [09-modularization.md](../docs/monorepo/09-modularization.md).
