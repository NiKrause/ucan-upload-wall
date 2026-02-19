import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const standaloneWorkerDir = path.resolve(
  rootDir,
  '../../orbitdb-identity-provider-webauthn-did/src/standalone/worker'
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react', '@le-space/orbitdb-identity-provider-webauthn-did', '@le-space/orbitdb-identity-provider-webauthn-did/standalone'],
  },
  define: {
    global: 'globalThis',
  },
  server: {
    fs: {
      // Needed in local migration mode where worker URL resolves to the linked package source.
      allow: [rootDir, standaloneWorkerDir],
    },
  },
  build: {
    // The app pulls in large libp2p/helia dependency trees; splitting is possible but
    // the default warning threshold is too low to be actionable for this project.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        // Dependencies brought in by polyfills (e.g. vm-browserify) trigger Rollup's
        // generic eval warning; it's noisy and not actionable here.
        if (warning.code === 'EVAL') return;

        // Rollup warns when the same module is both statically and dynamically
        // imported; in this app this is expected due to upstream deps.
        if (warning.code === 'DYNAMIC_IMPORT_AND_STATIC_IMPORT') return;
        if (
          typeof warning.message === 'string' &&
          warning.message.includes('is dynamically imported by') &&
          warning.message.includes('but also statically imported by')
        ) {
          return;
        }

        warn(warning);
      },
    },
  },
});
