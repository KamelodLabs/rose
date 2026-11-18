# Deployment and portability

Deployment is an artifact, not a platform. Both apps ship as OCI images driven by environment
variables. The same images run locally with Compose and on a VPS through Dokploy; Dokploy adds
orchestration and routing, it does not change the runtime.

## Quick path: local

```powershell
docker compose up --build        # api :8080, web :3000
docker compose down
```

## Quick path: VPS + Dokploy

1. Install Dokploy on a fresh VPS (its installer handles Docker and its own Traefik instance). Open
   `80`, `443` and the panel port.
2. Create a project and add a **Compose** service.
3. Provider: GitHub. Repository: this repo. Branch: `main`.
4. **Compose Path**: `./docker-compose.dokploy.yml`.
5. Deploy, then open the **Domains** tab:
   - `web` → service `web`, internal port `3000`, your domain. TLS is issued by Dokploy.
   - `api` → optional subdomain on service `api`, port `8080`. Skip it while the API is internal.
6. Environment variables are set in the Dokploy UI and referenced from Compose as `${VAR}`.

Nothing else is needed: Dokploy's Traefik handles the reverse proxy and certificates.

## The two Compose files

| File                         | Used by           | Ports                        | Network           | Domains    |
| ---------------------------- | ----------------- | ---------------------------- | ----------------- | ---------- |
| `docker-compose.yml`         | Local development | Published to the host        | Default project   | No         |
| `docker-compose.dokploy.yml` | Dokploy           | `expose` only, no host ports | `dokploy-network` | Dokploy UI |

Publishing host ports on the VPS is explicitly not recommended by Dokploy: it conflicts with other
apps and bypasses routing. Domains, TLS and labels live in Dokploy so nothing environment-specific
ends up in git.

## Configuration

| App | Variable   | Default   | Notes                          |
| --- | ---------- | --------- | ------------------------------ |
| api | `PORT`     | `8080`    | read at startup                |
| web | `PORT`     | `3000`    | read by the standalone server  |
| web | `HOSTNAME` | `0.0.0.0` | required to accept connections |

Dokploy writes UI variables to a `.env` file but does not inject them blindly: reference each one in
the Compose file (`environment: - FOO=${FOO}`). Secrets stay in Dokploy, never in git.

## Internal networking (when the web app calls the API)

Both services share the project network, so server-side calls use the service name:

```ts
const apiUrl = process.env.API_URL ?? 'http://api:8080';
```

This keeps the API private and avoids CORS entirely. If the browser must call the API directly, give
the API a subdomain in Dokploy and add CORS in the Go service — that is a product decision, not a
deployment requirement.

## Auto deploy

Dokploy's GitHub provider enables auto deploy without manual webhooks. Set the branch per environment
(e.g. `main` for production). If a push does not trigger a deploy, the usual cause is "Branch Not
Match": the branch configured in Dokploy differs from the pushed one.

Preview deployments (one environment per pull request) exist for **Applications**, not for Compose
services. If they become necessary, split `web` into an Application — it still uses the same
Dockerfile and context.

## Rollback

Dokploy keeps deployment history: redeploy the previous commit from the UI. Without Dokploy:

```bash
git checkout <previous-commit>
docker compose -f docker-compose.dokploy.yml up -d --build
```

## CI for images

`.github/workflows/images.yml` builds both images on PRs touching app or Docker files, with
`cache-from/to: type=gha`. It does not push and is not a required check: it reports breakage without
blocking merges. Dokploy builds from source on deploy, so a registry is optional.

## What is deliberately avoided

| Avoided                       | Reason                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| Vercel hosting                | Second build pipeline, provider runtime, Hobby ToS               |
| Hosted Turborepo remote cache | Couples caching to Vercel; GitHub cache covers current size      |
| EAS Update                    | Runtime updates coupled to Expo's service                        |
| Managed databases             | Nothing to manage yet; the choice stays open                     |
| Registry push                 | Dokploy builds from source; add GHCR only when there is a reason |

## Troubleshooting

| Symptom                              | Likely cause                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Domain never resolves / 404          | Broken healthcheck, wrong service name, or wrong internal port                |
| Deploy did not trigger               | Branch mismatch between Dokploy and the pushed branch                         |
| 502 after deploy                     | Container unhealthy or the domain points to a port the app does not listen on |
| Service unreachable from another app | Service not attached to the expected network                                  |

VPS sizing: Next.js production builds are memory-hungry. 4 GB is workable for this repo; 8 GB leaves
comfortable headroom for builds and containers.

## Checklist

- [ ] `docker compose config -q` and `docker compose -f docker-compose.dokploy.yml config -q` parse.
- [ ] Local stack serves the web app and `/health` without Dokploy.
- [ ] Dokploy Compose path points to `docker-compose.dokploy.yml`.
- [ ] Domains are configured in Dokploy, not hardcoded in the repo.
- [ ] No secret is baked into an image.

## Next step

Back to the index: [README.md](./README.md).
