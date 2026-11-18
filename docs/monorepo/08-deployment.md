# Deployment and portability

Deployment is an artifact, not a platform. Both apps ship as OCI images with environment-based
configuration, so the same files run on a laptop, on a VPS, or in any container host. Nothing in the
code assumes a specific provider.

## Quick path

```powershell
docker compose up --build        # api :8080, web :3000
docker compose ps                # api should report "healthy"
docker compose down
```

Requirements: Docker Engine or Docker Desktop running. No cloud account, no CLI login.

## Images

| Image            | Build context | Dockerfile           | Runtime base     | User      |
| ---------------- | ------------- | -------------------- | ---------------- | --------- |
| `rose/api:local` | `apiRose/`    | `apiRose/Dockerfile` | `alpine:3.22`    | `appuser` |
| `rose/web:local` | repo root     | `webRose/Dockerfile` | `node:24-alpine` | `node`    |

Why the web context is the repository root: pnpm workspaces resolve through the root
`pnpm-lock.yaml` and `pnpm-workspace.yaml`. The image installs only the web filter, then copies the
Next.js standalone output.

Why the standalone output is needed: `output: 'standalone'` in `next.config.ts` traces exactly the
files the server needs. In this monorepo the entrypoint lands at `webRose/server.js` inside the
standalone tree — that path is baked into the image command.

## Configuration

| App | Variable   | Default   | Notes                          |
| --- | ---------- | --------- | ------------------------------ |
| api | `PORT`     | `8080`    | read at startup                |
| web | `PORT`     | `3000`    | read by the standalone server  |
| web | `HOSTNAME` | `0.0.0.0` | required to accept connections |

Compose overrides the host ports without touching the file:

```powershell
$env:API_PORT=9000; $env:WEB_PORT=4000; docker compose up --build
```

## Moving to a VPS

The migration is a copy of the repo plus Docker:

```bash
git clone <repo> && cd rose
docker compose up -d --build
```

That is the entire procedure. There is no build step outside Docker, no platform config file, and no
provider CLI involved. Add a reverse proxy (Caddy or Traefik) for TLS when you expose it; that proxy is
independent of these images.

## What this deliberately avoids

| Avoided                       | Reason                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| Vercel hosting                | Second build pipeline, provider-specific runtime, ToS on Hobby   |
| Turborepo hosted remote cache | Ties caching to Vercel; GitHub cache already covers current size |
| EAS Update                    | Runtime updates coupled to Expo's service; not needed to ship    |
| Managed databases             | Nothing to manage yet; keep the choice open                      |
| Registry push                 | No destination yet; images build from source anywhere            |

When a destination exists, publishing to GHCR is additive: `docker/build-push-action` with
`push: true`. It does not change the Dockerfiles.

## CI for images

`.github/workflows/images.yml` builds both images on every PR that touches app or Docker files, with
`cache-from/to: type=gha`. It does **not** push and is **not** a required check: it reports breakage
without slowing merges.

## Rollback

Images are tagged by what built them. On a VPS, rebuild the previous commit and restart:

```bash
git checkout <previous-commit>
docker compose up -d --build
```

Once you publish images, tag them with the commit SHA and roll back by tag instead.

## Checklist

- [ ] `docker compose config -q` parses without warnings.
- [ ] `docker compose up --build` serves `/health` on the API and the app on the web port.
- [ ] No secret is baked into an image; everything sensitive arrives as an environment variable.
- [ ] A new deploy target requires zero changes outside `docker-compose.yml`.

## Next step

Back to the index: [README.md](./README.md).
