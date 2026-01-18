/**
 * Application configuration
 * Reads from environment variables with fallback to production values
 */

export const config = {
  uploadService: {
    url: import.meta.env.VITE_UPLOAD_SERVICE_URL || 'https://up.storacha.network',
    did: import.meta.env.VITE_UPLOAD_SERVICE_DID || 'did:web:up.storacha.network',
  }
} as const;

// Log configuration on load (helps with debugging)
console.log('📋 Upload Service Configuration:', {
  url: config.uploadService.url,
  did: config.uploadService.did,
});
