/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts', // or './setupTests.ts' if at root
    css: true, // if you want to test CSS
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'], // Only include tests in src
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'api/**', // Exclude the api directory
    ],
  },
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
