import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // W18 Lane A (Han) — proposal 04: keep view chunks small but warn early
    // if a per-route chunk grows past ~200 KB. The entry chunk should now
    // stay well under 150 KB.
    chunkSizeWarningLimit: 200,
    rollupOptions: {
      output: {
        // Group shared chart helpers into a single chunk so multiple lazy
        // views (dashboard, leaders, playerDetail) hit one cache entry
        // instead of duplicating the helpers per view chunk.
        manualChunks(id) {
          if (id.includes('/packages/web/src/charts/')) return 'charts';
          return undefined;
        },
      },
    },
  },
});
