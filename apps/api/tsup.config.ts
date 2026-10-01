import { defineConfig } from 'tsup';

// Les packages internes (@batimint/*) sont embarqués dans le bundle ; les dépendances npm restent externes.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@batimint\//],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
