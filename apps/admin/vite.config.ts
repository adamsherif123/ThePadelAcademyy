import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // @tpa/* are source-only TS workspace packages (no build step). Excluding them
    // from dep pre-bundling lets Vite transform them like first-party source.
    exclude: ['@tpa/types', '@tpa/theme'],
  },
});
