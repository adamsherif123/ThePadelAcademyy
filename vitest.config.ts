import { defineConfig } from 'vitest/config';

// Unit tests for the pure packages (@tpa/core, @tpa/types guard). The apps are
// not tested here — they have no logic in S1, only rendering proofs.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
