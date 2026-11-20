# syntax=docker/dockerfile:1

# Build context is the repository root: the pnpm workspace and lockfile live there.
FROM node:24-slim AS base
RUN npm install -g pnpm@10.33.4
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
RUN pnpm install --frozen-lockfile --filter @rose/webRose...

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter @rose/webRose build

# The standalone output mirrors the workspace layout: /app/webRose/server.js.
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /repo/webRose/.next/standalone ./
COPY --from=builder --chown=node:node /repo/webRose/.next/static ./webRose/.next/static
COPY --from=builder --chown=node:node /repo/webRose/public ./webRose/public

USER node
EXPOSE 3000

CMD ["node", "webRose/server.js"]
