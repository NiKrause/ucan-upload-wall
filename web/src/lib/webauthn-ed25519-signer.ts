/**
 * Compatibility bridge for WebAuthn varsig signers.
 *
 * This file keeps the historical upload-wall module path and export names,
 * while delegating implementation to the standalone toolkit package.
 */

export type WebAuthnCredentialOptions = {
  authenticatorType?: 'platform' | 'cross-platform' | 'any';
};

export {
  WebAuthnEd25519Signer,
  WebAuthnP256Signer,
  createWebAuthnEd25519Credential,
  checkEd25519Support
} from '@le-space/orbitdb-identity-provider-webauthn-did/standalone';
