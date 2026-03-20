import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '..'), '')
  const dashboardPort = parseInt(env['DASHBOARD_PORT'] ?? '3100', 10)
  const backendUrl = (env['VITE_BACKEND_URL'] ?? `http://localhost:${env['BACKEND_PORT'] ?? env['PORT'] ?? '3101'}`)
    .replace(/\/$/, '')

  return {
    envDir: '..',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env['VITE_SUPABASE_URL'] ?? env['SUPABASE_URL'] ?? ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env['VITE_SUPABASE_ANON_KEY'] ?? env['SUPABASE_ANON_KEY'] ?? ''),
    },
    plugins: [react()],
    optimizeDeps: {
      include: ['three', '@react-three/fiber', '@react-three/drei'],
    },
    server: {
      port: dashboardPort,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
