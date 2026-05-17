import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
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
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      base,
      scope: base,
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Philly Lacrosse Viz',
        short_name: 'PLL Viz',
        description: 'Philadelphia high-school boys lacrosse stats, standings, and game data.',
        theme_color: '#1a3a5c',
        background_color: '#0d1117',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pll-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /\.(js|css|svg|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pll-static-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
