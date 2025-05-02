import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { // Add server configuration
    proxy: {
      // Proxy requests starting with /api to the Azure Functions dev server
      '/api': {
        target: 'http://localhost:7072', // Update port to 7072
        changeOrigin: true,
        // Optional: You might not need to rewrite the path if your function routes match
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
    },
  },
});
