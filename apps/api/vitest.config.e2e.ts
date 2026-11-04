import { defineConfig } from 'vitest/config';

// The tests run against the compiled app in dist/ (decorator metadata is needed for Nest's DI),
// on a throwaway database that global-setup recreates on every run. `pnpm test` builds first.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.mjs'],
    globalSetup: ['test/global-setup.mjs'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
