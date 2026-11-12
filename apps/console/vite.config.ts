import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The console's build.
 *
 * The API base is a relative path, so the bundle works behind any host.
 */
export default defineConfig({
  plugins: [react()],
  // The landing page is the front door, so the console is served from a
  // path of its own. The bundle's assets are named relative to it.
  base: '/console/',
  server: {
    // In development the console runs on its own port and the API is
    // reached through the proxy.
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.SENTINEL_API ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
