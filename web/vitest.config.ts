import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // Use jsdom for full DOM + localStorage + WebAuthn mock support
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/webauthn-varsig/**/*.ts'],
      exclude: ['src/lib/webauthn-varsig/**/*.test.ts', 'src/lib/webauthn-varsig/**/*.spec.ts']
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});
