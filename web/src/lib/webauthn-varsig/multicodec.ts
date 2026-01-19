/**
 * Multicodec Constants for WebAuthn Varsig
 *
 * These multicodec prefixes identify the signature format in the varsig.
 * WebAuthn signatures are not raw Ed25519/P-256 signatures, so they need a
 * discriminant specific to WebAuthn.
 *
 * Reference: https://github.com/ChainAgnostic/varsig#signature-algorithm
 */

/**
 * Standard Ed25519 public key
 * Already defined in multicodec table
 */
export const ED25519_PUB = 0xed;

/**
 * WebAuthn-wrapped Ed25519 signature (varsig discriminant)
 * Matches the le-space ucanto fork for WebAuthn Ed25519 varsig.
 */
export const WEBAUTHN_ED25519 = 0xd1ed;

/**
 * WebAuthn-wrapped P-256 signature (varsig discriminant).
 * TODO: Update when a canonical multicodec is registered.
 */
export const WEBAUTHN_P256 = 0xd1f2;

/**
 * Standard P-256 public key
 * Already defined in multicodec table
 */
export const P256_PUB = 0x1200;

/**
 * Map of algorithm names to multicodecs
 */
export const ALGORITHM_TO_MULTICODEC = {
  'Ed25519': WEBAUTHN_ED25519,
  'P-256': WEBAUTHN_P256,
} as const;

/**
 * Map of multicodecs to algorithm names
 */
export const MULTICODEC_TO_ALGORITHM = {
  [WEBAUTHN_ED25519]: 'Ed25519',
  [WEBAUTHN_P256]: 'P-256',
} as const;

/**
 * Check if a multicodec represents a WebAuthn signature
 */
export function isWebAuthnMulticodec(multicodec: number): boolean {
  return multicodec === WEBAUTHN_ED25519 || multicodec === WEBAUTHN_P256;
}

/**
 * Get algorithm name from multicodec
 */
export function getAlgorithm(multicodec: number): 'Ed25519' | 'P-256' | null {
  return MULTICODEC_TO_ALGORITHM[multicodec as keyof typeof MULTICODEC_TO_ALGORITHM] || null;
}
