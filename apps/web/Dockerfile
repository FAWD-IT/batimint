# syntax=docker/dockerfile:1.7
# Image web : Next.js en sortie « standalone ».
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true npm_config_update_notifier=false NEXT_TELEMETRY_DISABLED=1
# Secret « ca » facultatif : AC TLS d'un proxy d'entreprise ou du bac à sable (sans effet sinon).
RUN --mount=type=secret,id=ca,required=false test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm i -g pnpm@10.28.0 turbo@2.11.6 --silent
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN turbo prune @batimint/web --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=secret,id=ca,required=false --mount=type=cache,id=pnpm,target=/pnpm/store test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY tsconfig.base.json ./
RUN --mount=type=secret,id=ca,required=false test -f /run/secrets/ca && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; pnpm --filter @batimint/web build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
