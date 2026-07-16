import { defineConfig } from 'vitest/config';

// Unit tests for the pure packages (@tpa/core, @tpa/types guard) AND the mobile
// data layer — the store + mutation seams (bookSlot / cancelBooking) that move
// money-equivalent value. Those live in apps/mobile/src/data and import only
// @tpa/* + react (no react-native), so they run under the node environment here.
// Screens/components are still not tested (rendering proofs only).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
