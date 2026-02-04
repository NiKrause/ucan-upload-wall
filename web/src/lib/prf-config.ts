/**
 * PRF (Pseudo-Random Function) Configuration
 * 
 * Centralized configuration for WebAuthn PRF extension values.
 * These values must be consistent across the entire application
 * to ensure deterministic key derivation.
 */

// Environment-based PRF configuration
const PRF_BASE = import.meta.env.VITE_PRF_BASE || 'storacha';
const PRF_VERSION = import.meta.env.VITE_PRF_VERSION || 'v1';

/**
 * PRF values used throughout the application
 */
export const PRF_CONFIG = {
  // Main PRF input for WebAuthn credential creation and authentication
  ROOT: `${PRF_BASE}.ucan.root.${PRF_VERSION}`,
  
  // PRF input for Ed25519 key derivation via HKDF
  ED25519_UCAN: `${PRF_BASE}.ed25519.ucan.${PRF_VERSION}`,
  
  // PRF input for keystore encryption in worker
  KEYSTORE: `${PRF_BASE}/ed25519-keystore.${PRF_VERSION}`,
} as const;

/**
 * Get PRF input as BufferSource for WebAuthn operations
 */
export function getPrfInput(type: keyof typeof PRF_CONFIG): BufferSource {
  return new TextEncoder().encode(PRF_CONFIG[type]);
}

/**
 * Get PRF input as string for logging/debugging
 */
export function getPrfString(type: keyof typeof PRF_CONFIG): string {
  return PRF_CONFIG[type];
}

// Export individual PRF values for convenience
export const PRF_ROOT = PRF_CONFIG.ROOT;
export const PRF_ED25519_UCAN = PRF_CONFIG.ED25519_UCAN;
export const PRF_KEYSTORE = PRF_CONFIG.KEYSTORE;