/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const enablePwa = mode === 'production'
  const enableAuthBrowserFixtures = String(process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES ?? '').trim().toLowerCase() === 'true'

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        disable: !enablePwa,
        registerType: 'prompt',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'browserconfig.xml',
          'og-image.png',
          'twitter-image.png',
          'football-player-logo.png',
          'icons/favicon-16.png',
          'icons/favicon-32.png',
          'icons/favicon-48.png',
          'icons/mstile-150.png',
          'push-sw.js',
        ],
        manifest: {
          name: 'Football Player',
          short_name: 'Football Player',
          description: 'Football club assessment software for player feedback, reports, and parent communication.',
          theme_color: '#07120c',
          background_color: '#07120c',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icons/favicon-48.png',
              sizes: '48x48',
              type: 'image/png',
            },
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/icons/maskable-icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icons/maskable-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['push-sw.js'],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg}'],
          cleanupOutdatedCaches: true,
          // Keep update activation user-driven so hard refreshes do not trigger a second page load.
          clientsClaim: false,
          skipWaiting: false,
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'app-navigation',
                networkTimeoutSeconds: 3,
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/@supabase')) {
              return 'supabase'
            }

            if (id.includes('node_modules/react') || id.includes('node_modules/react-router-dom')) {
              return 'react-vendor'
            }

            if (id.includes('node_modules')) {
              return 'vendor'
            }

            if (id.includes('/src/lib/domain/')) {
              return 'domain'
            }

            return undefined
          },
        },
      },
    },
    server: enableAuthBrowserFixtures
      ? {
          allowedHosts: [
            'parent.footballplayer.online',
          ],
        }
      : undefined,
  }
})
