import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import AstroPWA from '@vite-pwa/astro'

// Static build for GitHub Pages.
// `base` must match the repository name so assets resolve under
// https://<user>.github.io/nostalge-client/
export default defineConfig({
  site: 'https://rossmclachlan.github.io',
  base: '/nostalge-client',
  output: 'static',
  integrations: [
    react(),
    AstroPWA({
      registerType: 'autoUpdate',
      // We wire the manifest link + SW registration ourselves in Layout.astro
      // because vite-plugin-pwa's auto-injection (transformIndexHtml) doesn't
      // run against Astro's generated pages.
      injectRegister: false,
      // Icons are referenced relative to the manifest, so they pick up the
      // /nostalge-client/ base automatically. scope/start_url are pinned to
      // the base path (the usual GitHub-Pages-subpath gotcha).
      manifest: {
        name: 'Nostalge — record crate',
        short_name: 'Nostalge',
        description: 'Rediscover the music you already own.',
        lang: 'en',
        theme_color: '#1b1712',
        background_color: '#f1e7d0',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/nostalge-client/',
        start_url: '/nostalge-client/',
        id: '/nostalge-client/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Precache the app shell so it launches offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        // Keep album / artist art around once seen, even off-network.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-art',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
