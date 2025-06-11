import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'url';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Only use proxy in development mode
    ...(mode === 'development' && {
      proxy: {
        '/api': 'http://localhost:3000',
      },
    }),
  },
  // Ensure build works correctly for production
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})); 