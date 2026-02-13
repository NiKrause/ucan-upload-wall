import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
  ],
  // Needed so `?worker` builds as ESM and supports code splitting. Some plugin combos
  // can otherwise end up with `worker.format = iife`, which breaks production builds.
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    global: 'globalThis',
  },
});
