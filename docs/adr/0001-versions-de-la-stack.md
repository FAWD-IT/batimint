# ADR 0001 — Versions de la stack

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`CLAUDE.md` fixe la stack (pnpm + Turborepo, Next.js, Fastify 5, Prisma, pg-boss, zod) sans versions. Plusieurs paquets ont changé de génération récemment.

## Décision
- Node 22 LTS, pnpm 10, Turborepo 2, **TypeScript 5.9** (TS 7 natif n'est pas encore supporté par typescript-eslint).
- **Prisma 7.10** avec le générateur `prisma-client` (code TS généré dans `packages/db/src/generated`) et l'adaptateur `@prisma/adapter-pg` : plus de moteur de requêtes binaire, le client est embarqué dans les bundles.
- **Next.js 16** (Turbopack, `proxy.ts` remplace `middleware.ts`), React 19, **Tailwind 4** (configuration CSS `@theme`).
- **Fastify 5** + `fastify-type-provider-zod` 7, **zod 4**, OpenAPI 3.1 généré.
- **pg-boss 12** (adaptateur Prisma natif pour publier dans la transaction du relais, LISTEN/NOTIFY).
- **Vitest 4**, **Playwright 1.56.1** (épinglé : correspond au Chromium préinstallé de la session cloud ; la CI télécharge le même).
- ESLint 10 (flat config unique à la racine), Prettier 3.

## Conséquences
Les montées de version majeures passent par un nouvel ADR. Prisma 8 (en RC) sera évalué quand il sera stable.
