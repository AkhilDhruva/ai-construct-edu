/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The service worker precaches every built asset, which is what makes the
// no-API floor work with no network at all (success criterion 2).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'VeraClause Mantle — AI Construct Education',
        short_name: 'Mantle',
        description: 'Learn agentic AI system design one interactive lab per concept. Works offline.',
        theme_color: '#14532d',
        background_color: '#0b1210',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  build: {
    // React, Dexie, Zod, framer-motion and every tentacle's validated content ship in the
    // entry chunk (~190 kB gzip with three tentacles); routes and labs are split and all of
    // it is precached offline. Loading tentacle content on demand is a later optimisation.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
})
