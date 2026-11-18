# Web app (`webRose`)

Next.js 16 with the App Router, React 19, and Tailwind 4 (wired through Turbopack). Runs on port 3000
and builds to a static/optimized output with route types generated from the filesystem.

## Quick path

```powershell
pnpm --filter @rose/webRose dev      # http://localhost:3000
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

## Layout

| Path                  | Responsibility                                 |
| --------------------- | ---------------------------------------------- |
| `src/app/layout.tsx`  | root layout                                    |
| `src/app/page.tsx`    | `/` route                                      |
| `src/app/globals.css` | Tailwind entrypoint                            |
| `src/app/**`          | every folder/file becomes a route              |
| `public/`             | static assets                                  |
| `next.config.ts`      | cache components, prefetching, Tailwind loader |
| `tsconfig.json`       | extends `../tsconfig.base.json`                |

Alias: `@/*` resolves to `webRose/src/*`.

## Commands

| Task        | Command                                             |
| ----------- | --------------------------------------------------- |
| Dev         | `pnpm --filter @rose/webRose dev`                   |
| Build       | `pnpm exec turbo run build --filter=@rose/webRose`  |
| Start prod  | `pnpm --filter @rose/webRose start` (after a build) |
| Lint        | `pnpm --filter @rose/webRose lint`                  |
| Type check  | `pnpm --filter @rose/webRose check-types`           |
| Custom port | `pnpm --filter @rose/webRose exec next dev -p 3001` |

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
- [ ] `pnpm exec turbo run build --filter=@rose/webRose` succeeds.
- [ ] New client components have `'use client'` at the top.

## Next step

Mobile app: [05-mobile.md](./05-mobile.md).
