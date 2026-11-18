# API (`apiRose`)

A small Go HTTP service built on the standard library. It runs on port 8080, exposes a health check,
logs every request, and shuts down gracefully. No framework until a real reason appears.

## Quick path

```powershell
pnpm --filter @rose/apiRose dev     # go run ./cmd/server
Invoke-WebRequest http://localhost:8080/health
```

Expected: `{"status":"ok"}`.

## Layout

| Path                        | Responsibility                                    |
| --------------------------- | ------------------------------------------------- |
| `go.mod`                    | module `rose/apiRose`, Go 1.26                    |
| `cmd/server/main.go`        | config, mux wiring, middleware, graceful shutdown |
| `internal/health/health.go` | `/health` handler                                 |
| `internal/<domain>/`        | each new domain gets its own package              |
| `bin/server.exe`            | build output (gitignored)                         |

## Behavior

| Concern      | Detail                                                        |
| ------------ | ------------------------------------------------------------- |
| Port         | `PORT` env var, default `8080`                                |
| Routes       | `GET /health` (method-scoped pattern, Go 1.22+ mux)           |
| Logging      | `log/slog` structured logs: method, path, status, duration    |
| Timeouts     | `ReadHeaderTimeout: 5s`; shutdown budget 10s                  |
| Shutdown     | `signal.NotifyContext` on SIGINT/SIGTERM, then `srv.Shutdown` |
| Dependencies | zero (stdlib only)                                            |

## Commands

| Task           | Command                                            |
| -------------- | -------------------------------------------------- |
| Dev (via root) | `pnpm --filter @rose/apiRose dev`                  |
| Dev (direct)   | `go run ./cmd/server` from `apiRose/`              |
| Build          | `pnpm --filter @rose/apiRose build`                |
| Test           | `pnpm --filter @rose/apiRose test`                 |
| Vet / lint     | `pnpm --filter @rose/apiRose lint`                 |
| Add a module   | `go get <module>` then `go mod tidy` in `apiRose/` |

`build` writes `bin/server.exe` because this repo is Windows-first. On Linux/macOS change the script in
`apiRose/package.json` to `go build -o bin/server ./cmd/server`.

## Add an endpoint

1. Create the package, e.g. `internal/greeting/greeting.go`:

```go
package greeting

import (
	"encoding/json"
	"net/http"
)

func Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "hello"})
	}
}
```

2. Register it in `cmd/server/main.go`:

```go
mux.Handle("GET /greeting", greeting.Handler())
```

3. Run `pnpm --filter @rose/apiRose check-types` (it runs `go vet`) and `test`.

## Conventions

- Handlers live in `internal/<domain>/`, not in `main`.
- `main` only wires dependencies; no business logic there.
- Prefer stdlib. Introduce a router or ORM only when the requirement is concrete.
- Tests live next to the code as `*_test.go`.
- Return JSON consistently; set `Content-Type` before writing the body.

## Checklist

- [ ] `go vet ./...` passes from `apiRose/`.
- [ ] `GET /health` returns `{"status":"ok"}`.
- [ ] New routes are registered with a method prefix (`GET /path`).

## Next step

Web app: [04-web.md](./04-web.md). Mobile app: [05-mobile.md](./05-mobile.md).
