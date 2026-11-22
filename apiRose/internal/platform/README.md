# Go platform

Reserved for infrastructure shared by API domains: configuration, logging, middleware, database, and
observability.

- No domain logic and no imports of `internal/<domain>`.
- Domains may import this package; the dependency direction never reverses.
- Create a subpackage only when a real platform concern needs one.

Standard: [09-modularization.md](../../../docs/monorepo/09-modularization.md).
