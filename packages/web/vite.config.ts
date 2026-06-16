import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Infrahub server (dual-backend dev) — must precede '/api' since
      // '/api-infrahub/...' also starts with '/api'; first match wins. The
      // prefix is stripped so the upstream sees ordinary '/api/...' routes.
      '/api-infrahub': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-infrahub/, '/api'),
      },
      '/api': 'http://localhost:3001',
    },
  },
})
