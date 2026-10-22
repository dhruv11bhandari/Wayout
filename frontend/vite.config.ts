import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The launcher passes the selected FastAPI port so frontend and backend stay aligned.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://${process.env.WAYOUT_HOST || '127.0.0.1'}:${process.env.WAYOUT_PORT || '8000'}`,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
