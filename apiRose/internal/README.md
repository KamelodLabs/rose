# Go internal packages

Domain and infrastructure code for the API.

- `internal/<domain>/` owns one business domain and its exported API.
- `internal/platform/` is reserved for configuration, logging, middleware, database, and observability.
- `cmd/<binary>/` wires dependencies and process concerns; it contains no business logic.
- Domains may import `internal/platform`; `platform` must not import domains.
- Do not add `packages/` to Go; `internal/` is compiler-enforced privacy.

Standard: [09-modularization.md](../../docs/monorepo/09-modularization.md).
