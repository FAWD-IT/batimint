# syntax=docker/dockerfile:1.7
# Image API (sert aussi au service `migrate` et au seed). Multi-étapes : prune → build → runtime.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true npm_config_update_notifier=false
# Secret « ca » facultatif : AC TLS d'un proxy d'entreprise ou du bac à sable (sans effet sinon).
RUN --mount=type=secret,id=ca,required=false test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm i -g pnpm@10.28.0 turbo@2.11.6 --silent
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN turbo prune @batimint/api @batimint/db --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm install --frozen-lockfile --config.node-linker=hoisted
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN --mount=type=secret,id=ca,required=false test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm --filter @batimint/db generate \
 && pnpm --filter @batimint/api build \
 && pnpm --filter @batimint/db build

FROM base AS prod-deps
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm install --frozen-lockfile --prod --config.node-linker=hoisted \
 && node_modules/.bin/prisma version >/dev/null  # précharge le moteur de migration (aucun téléchargement au démarrage)

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PATH=/app/node_modules/.bin:$PATH
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=builder --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /repo/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=node:node /repo/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=node:node /repo/packages/db/prisma.config.ts /repo/packages/db/package.json ./packages/db/
COPY --from=builder --chown=node:node /repo/package.json ./package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
