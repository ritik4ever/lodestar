import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.js'],
    // The backend's own suites, plus the shared packages it consumes (#853).
    // CI runs `npm test` from this directory, so including the package here is
    // what keeps its property tests running without a second CI job.
    include: ['**/*.test.js', '../packages/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
