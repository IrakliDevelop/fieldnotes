import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/sync.ts', 'src/server.ts', 'src/redis.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@fieldnotes/core',
    '@fieldnotes/sync',
    '@fieldnotes/sync-server',
    '@fieldnotes/sync-redis',
  ],
});
