# syntax=docker/dockerfile:1.7

# Build context is the repository root: the pnpm workspace and lockfile live there.
FROM node:24-bookworm-slim AS base
RUN --mount=type=cache,target=/root/.npm npm install -g pnpm@10.33.4
WORKDIR /repo
# Do not run the root prepare hook here: this stage has no .git directory for husky.
ENV HUSKY=0

# Install only what the web app needs. Every workspace manifest must exist so the
# frozen lockfile can be validated.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apiRose/package.json ./apiRose/
COPY webRose/package.json ./webRose/
COPY mobileRose/package.json ./mobileRose/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @rose/webRose...

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY webRose ./webRose
COPY packages ./packages
RUN pnpm --filter @rose/webRose build

# Distroless Node runs /nodejs/bin/node as its entrypoint. The standalone output
# mirrors the workspace layout: /app/webRose/server.js.
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

COPY --link --from=builder --chown=65532:65532 /repo/webRose/.next/standalone ./
COPY --link --from=builder --chown=65532:65532 /repo/webRose/.next/static ./webRose/.next/static
COPY --link --from=builder --chown=65532:65532 /repo/webRose/public ./webRose/public

USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["webRose/server.js"]
