import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/fuzz/**/*.test.ts'], environment: 'node', testTimeout: 120_000 },
});
