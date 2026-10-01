# syntax=docker/dockerfile:1.7
# Image worker : consommateurs d'événements et jobs planifiés.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true npm_config_update_notifier=false
# Secret « ca » facultatif : AC TLS d'un proxy d'entreprise ou du bac à sable (sans effet sinon).
RUN --mount=type=secret,id=ca,required=false test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm i -g pnpm@10.28.0 turbo@2.11.6 --silent
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN turbo prune @batimint/worker --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm install --frozen-lockfile --config.node-linker=hoisted
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN --mount=type=secret,id=ca,required=false test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm --filter @batimint/db generate && pnpm --filter @batimint/worker build

FROM base AS prod-deps
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm install --frozen-lockfile --prod --config.node-linker=hoisted

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production WORKER_HEALTH_FILE=/tmp/batimint-worker-heartbeat
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=builder --chown=node:node /repo/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=node:node /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=node:node /repo/package.json ./package.json
USER node
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 CMD ["node", "apps/worker/dist/healthcheck.js"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/worker/dist/main.js"]
