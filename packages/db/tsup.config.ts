import { defineConfig } from 'tsup';

// Scripts d'exploitation compilés pour l'image de production (migrate, seed, admin:create).
export default defineConfig({
  entry: ['scripts/migrate.ts', 'scripts/seed.ts', 'scripts/admin-create.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  noExternal: [/^@batimint\//],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
