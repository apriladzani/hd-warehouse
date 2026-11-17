import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  // VITE_API_URL is often relative ('/api', same origin in production); the dev proxy needs an absolute target.
  const rawApiUrl = process.env.VITE_API_URL || env.VITE_API_URL || '';
  const backend = new URL(/^https?:\/\//i.test(rawApiUrl) ? rawApiUrl : 'http://127.0.0.1:5001');
  // Backend listens on IPv4; avoid localhost IPv6 resolution mismatches.
  if (backend.hostname === 'localhost') backend.hostname = '127.0.0.1';
  const apiTarget = backend.toString();
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
