# Web app (`webRose`)

Next.js 16 with the App Router, React 19, and Tailwind 4 (wired through Turbopack). Runs on port 3000
and builds to a standalone server bundle (`output: 'standalone'`) that the Docker image runs.

## Quick path

```powershell
pnpm --filter @rose/webRose dev      # http://localhost:3000
pnpm --filter @rose/webRose test     # Vitest + jsdom
pnpm exec turbo run build --filter=@rose/webRose
```

## Stack

| Piece    | Version | Notes                                                      |
| -------- | ------- | ---------------------------------------------------------- |
| Next.js  | 16.4.6  | Turbopack is the default engine for dev and build          |
| React    | 19.3.0  | Server Components by default                               |
| Tailwind | 4.3.3   | Loaded by `@tailwindcss/turbopack` in `next.config.ts`     |
| TS       | ^5      | `next typegen` generates route types before `tsc --noEmit` |
| ESLint   | ^9      | `eslint-config-next` flat config                           |
| Vitest   | 5.1.1   | jsdom + Testing Library                                    |

## Layout

| Path                  | Responsibility                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`  | root layout                                                                                                       |
| `src/app/page.tsx`    | `/` route                                                                                                         |
| `src/app/globals.css` | Tailwind entrypoint                                                                                               |
| `src/app/**`          | `page.tsx` and `route.ts` create routes; `layout.tsx` wraps them. `globals.css` and static assets are not routes. |
| `src/features/`       | business capabilities (app-local modules); see below                                                              |
| `src/shared/`         | reusable app code: `ui`, `lib`, `hooks`, `types`, `config`                                                        |
| `src/__tests__/`      | app-level Vitest tests                                                                                            |
| `public/`             | static assets                                                                                                     |
| `next.config.ts`      | standalone output, cache components, Tailwind                                                                     |
| `vitest.config.mts`   | jsdom, `@` alias, test include                                                                                    |
| `tsconfig.json`       | extends `../tsconfig.base.json`                                                                                   |

Alias: `@/*` resolves to `webRose/src/*`.

## Modules

- Business code lives in `src/features/<feature>`. A feature exposes its public API from `index.ts`
  and may contain `api/`, `components/`, `hooks/`, `model/`, `lib/`, and `__tests__/` as needed.
- Reusable primitives go in `src/shared/ui`; third-party adapters in `src/shared/lib`; generic hooks
  in `src/shared/hooks`; cross-feature types in `src/shared/types`; app-wide configuration in
  `src/shared/config`.
- `src/app` is the composition root: routes, layouts, providers, and thin wiring.
- Import features only through `@/features/<feature>`; no deep imports.
- `shared` must not import `features` or `app`; a feature must not import another feature.
- Small features collapse layers. Never create empty folders or a `package.json` inside `src`.

Full standard: [09-modularization.md](./09-modularization.md). Run `pnpm modularity`.

## Commands

| Task        | Command                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev         | `pnpm --filter @rose/webRose dev`                                                                                                            |
| Build       | `pnpm exec turbo run build --filter=@rose/webRose`                                                                                           |
| Start prod  | `pnpm --filter @rose/webRose start` (after a build; it copies `.next/static` and `public` into the standalone tree), or run the Docker image |
| Lint        | `pnpm --filter @rose/webRose lint`                                                                                                           |
| Type check  | `pnpm --filter @rose/webRose check-types`                                                                                                    |
| Test        | `pnpm --filter @rose/webRose test`                                                                                                           |
| Test watch  | `pnpm --filter @rose/webRose test:watch`                                                                                                     |
| Custom port | `pnpm --filter @rose/webRose exec next dev -p 3001`                                                                                          |

## Container image

`webRose/Dockerfile` builds from the repo root because the pnpm workspace and lockfile live there.
The runtime is `gcr.io/distroless/nodejs24-debian12:nonroot`: no shell, no package manager, and the
non-root `nonroot` user. Distroless Node's entrypoint is `/nodejs/bin/node`, so the Dockerfile only
declares `CMD ["webRose/server.js"]`; `PORT` (3000) and `HOSTNAME` (0.0.0.0) are baked into the image.

- **deps** copies the workspace manifests and runs a frozen, filtered `pnpm install` for
  `@rose/webRose`, with a BuildKit cache mount for the pnpm store.
- **builder** copies only `tsconfig.base.json`, `webRose/`, and `packages/` over that install and
  runs `pnpm --filter @rose/webRose build` (standalone output).
- **runner** copies `.next/standalone`, `.next/static`, and `public` with `COPY --link`.

The image healthcheck is an exec-form Node `fetch` of `/` because the runtime has no shell. CI builds
the image with `load: true` and smoke-tests `GET /` on host port 13000 before the job finishes.

## Testing

Vitest + jsdom + Testing Library. `vitest.config.mts` sets `environment: 'jsdom'`, maps the `@` alias
to `src`, and includes `src/**/*.test.{ts,tsx}`.

`src/__tests__/home.test.tsx` is the starter test. It mocks `next/image` with a plain `<img>` because
there is no Next image optimizer under jsdom; keep that stub in tests that render images.

| Task     | Command                                  |
| -------- | ---------------------------------------- |
| Run once | `pnpm --filter @rose/webRose test`       |
| Watch    | `pnpm --filter @rose/webRose test:watch` |

## Add a route

Create `src/app/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return <main className="p-8 text-2xl font-semibold">Dashboard</main>;
}
```

It is served at `/dashboard`. Add `layout.tsx` in the same folder to scope a layout to that route.

## Server vs client

- Components are **Server Components** by default: no hooks, no browser APIs.
- Add `'use client'` only to components that need state, effects, or event handlers.
- Keep `'use client'` boundaries small; data fetching belongs on the server.

## Environment variables

- Only `NEXT_PUBLIC_*` variables reach the browser.
- Local overrides go in `webRose/.env.local` (gitignored).
- Turbo includes `.env*` in build inputs, so changing them invalidates the build cache.

## Checklist

- [ ] `pnpm --filter @rose/webRose check-types` passes (it runs `next typegen` first).
- [ ] `pnpm --filter @rose/webRose test` passes.
- [ ] `pnpm exec turbo run build --filter=@rose/webRose` succeeds.
- [ ] New client components have `'use client'` at the top.
- [ ] `pnpm modularity` passes and features are imported only through their public index.

## Next step

Mobile app: [05-mobile.md](./05-mobile.md).
