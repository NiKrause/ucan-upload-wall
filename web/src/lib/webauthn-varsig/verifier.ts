/**
 * WebAuthn Signature Verifier
 * 
 * Verifies WebAuthn Ed25519 and P-256 signatures
 */

import { parseClientDataJSON } from './decoder.js';
import type { DecodedVarsig, ClientDataJSON } from './types.js';
import { base64urlToBytes, bytesEqual } from './utils.js';

/**
 * Verification options
 */
export interface VerificationOptions {
  expectedOrigin: string;
  expectedChallenge: Uint8Array;
  requireUserVerification?: boolean;
}

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  error?: string;
  clientData?: ClientDataJSON;
  flags?: {
    userPresent: boolean;
    userVerified: boolean;
    backupEligible: boolean;
    backupState: boolean;
  };
}

/**
 * Verify WebAuthn assertion components
 * 
 * This function validates the WebAuthn assertion structure and metadata.
 * Note: Actual cryptographic signature verification requires Web Crypto API
 * or a cryptographic library and the public key.
 * 
 * @param decoded - Decoded varsig data
 * @param options - Verification options
 * @returns Verification result
 */
export function verifyWebAuthnAssertion(
  decoded: DecodedVarsig,
  options: VerificationOptions
): VerificationResult {
  try {
    // 1. Parse clientDataJSON
    const clientData = parseClientDataJSON(decoded.clientDataJSON);
    
    // 2. Verify ceremony type
    if (clientData.type !== 'webauthn.get') {
      return {
        valid: false,
        error: `Invalid ceremony type: ${clientData.type}, expected 'webauthn.get'`
      };
    }
    
    // 3. Verify origin
    if (clientData.origin !== options.expectedOrigin) {
      return {
        valid: false,
        error: `Origin mismatch: expected ${options.expectedOrigin}, got ${clientData.origin}`
      };
    }
    
    // 4. Verify challenge
    const challengeBytes = base64urlToBytes(clientData.challenge);
    if (!bytesEqual(challengeBytes, options.expectedChallenge)) {
      return {
        valid: false,
        error: 'Challenge mismatch'
      };
    }
    
    // 5. Parse authenticatorData flags
    if (decoded.authenticatorData.length < 37) {
      return {
        valid: false,
        error: `Invalid authenticatorData length: ${decoded.authenticatorData.length}, expected >= 37`
      };
    }
    
    const flags = decoded.authenticatorData[32];
    const userPresent = (flags & 0x01) !== 0;
    const userVerified = (flags & 0x04) !== 0;
    const backupEligible = (flags & 0x08) !== 0;
    const backupState = (flags & 0x10) !== 0;
    
    // 6. Verify user presence
    if (!userPresent) {
      return {
        valid: false,
        error: 'User presence (UP) flag not set'
      };
    }
    
    // 7. Verify user verification if required
    if (options.requireUserVerification !== false && !userVerified) {
      return {
        valid: false,
        error: 'User verification (UV) flag not set'
      };
    }
    
    // All checks passed
    return {
      valid: true,
      clientData,
      flags: {
        userPresent,
        userVerified,
        backupEligible,
        backupState
      }
    };
  } catch (error) {
    return {
      valid: false,
      error: `Verification failed: ${(error as Error).message}`
    };
  }
}

/**
 * Reconstruct the data that was signed by WebAuthn
 * 
 * WebAuthn signs: authenticatorData || SHA-256(clientDataJSON)
 * 
 * @param decoded - Decoded varsig data
 * @returns The data that was signed
 */
export async function reconstructSignedData(decoded: DecodedVarsig): Promise<Uint8Array> {
  // Hash clientDataJSON
  const clientDataHash = await crypto.subtle.digest(
    'SHA-256',
    decoded.clientDataJSON
  );
  
  // Concatenate authenticatorData || clientDataHash
  const signedData = new Uint8Array(
    decoded.authenticatorData.length + clientDataHash.byteLength
  );
  signedData.set(decoded.authenticatorData, 0);
  signedData.set(new Uint8Array(clientDataHash), decoded.authenticatorData.length);
  
  return signedData;
}

/**
 * Verify Ed25519 signature (requires Web Crypto API)
 * 
 * @param signedData - The data that was signed
 * @param signature - The signature to verify
 * @param publicKey - The Ed25519 public key (32 bytes)
 * @returns True if signature is valid
 */
export async function verifyEd25519Signature(
  signedData: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    // Import public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKey,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    
    // Verify signature
    return await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signature,
      signedData
    );
  } catch (error) {
    console.error('Ed25519 verification failed:', error);
    return false;
  }
}

/**
 * Verify P-256 signature (requires Web Crypto API)
 * 
 * @param signedData - The data that was signed
 * @param signature - The signature to verify (DER format)
 * @param publicKey - The P-256 public key (uncompressed, 65 bytes)
 * @returns True if signature is valid
 */
export async function verifyP256Signature(
  signedData: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    // Import public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    
    // Verify signature
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      signature,
      signedData
    );
  } catch (error) {
    console.error('P-256 verification failed:', error);
    return false;
  }
}
