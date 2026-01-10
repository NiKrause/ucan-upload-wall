/**
 * Mock WebAuthn Data for Testing
 * 
 * Provides realistic WebAuthn assertion data for unit tests
 * without requiring actual WebAuthn credentials
 */

import type { WebAuthnAssertion, ClientDataJSON } from './types.js';

/**
 * Create mock authenticatorData
 * 
 * Authenticator data format (37+ bytes):
 * - rpIdHash (32 bytes): SHA-256 hash of the RP ID
 * - flags (1 byte): UP, UV, BE, BS, AT, ED flags
 * - signCount (4 bytes): Signature counter
 * - extensions (variable): Optional extension data
 */
export function createMockAuthenticatorData(options: {
  userPresent?: boolean;
  userVerified?: boolean;
  signCount?: number;
} = {}): Uint8Array {
  const {
    userPresent = true,
    userVerified = true,
    signCount = 1
  } = options;
  
  // Mock rpIdHash (32 bytes of pseudo-random data)
  const rpIdHash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    rpIdHash[i] = (i * 7 + 13) % 256;
  }
  
  // Flags byte
  let flags = 0;
  if (userPresent) flags |= 0x01;  // UP (User Present)
  if (userVerified) flags |= 0x04;  // UV (User Verified)
  
  // Sign count (4 bytes, big-endian)
  const signCountBytes = new Uint8Array(4);
  signCountBytes[0] = (signCount >> 24) & 0xff;
  signCountBytes[1] = (signCount >> 16) & 0xff;
  signCountBytes[2] = (signCount >> 8) & 0xff;
  signCountBytes[3] = signCount & 0xff;
  
  // Concatenate: rpIdHash + flags + signCount
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash, 0);
  authenticatorData[32] = flags;
  authenticatorData.set(signCountBytes, 33);
  
  return authenticatorData;
}

/**
 * Create mock clientDataJSON
 */
export function createMockClientDataJSON(options: {
  challenge?: string;
  origin?: string;
  type?: 'webauthn.get' | 'webauthn.create';
} = {}): Uint8Array {
  const {
    challenge = 'mock-challenge-base64url',
    origin = 'https://example.com',
    type = 'webauthn.get'
  } = options;
  
  const clientData: ClientDataJSON = {
    type,
    challenge,
    origin,
    crossOrigin: false
  };
  
  const jsonString = JSON.stringify(clientData);
  return new TextEncoder().encode(jsonString);
}

/**
 * Create mock Ed25519 signature (64 bytes)
 */
export function createMockEd25519Signature(): Uint8Array {
  const signature = new Uint8Array(64);
  // Fill with pseudo-random data
  for (let i = 0; i < 64; i++) {
    signature[i] = (i * 3 + 7) % 256;
  }
  return signature;
}

/**
 * Create mock P-256 signature (typically 70-72 bytes in DER format)
 */
export function createMockP256Signature(): Uint8Array {
  // DER-encoded ECDSA signature structure
  // 0x30 [length] 0x02 [r-length] [r-bytes] 0x02 [s-length] [s-bytes]
  const r = new Uint8Array(32);
  const s = new Uint8Array(32);
  
  // Fill with pseudo-random data
  for (let i = 0; i < 32; i++) {
    r[i] = (i * 5 + 11) % 256;
    s[i] = (i * 7 + 13) % 256;
  }
  
  // Build DER structure
  const signature = new Uint8Array(6 + 32 + 32);
  signature[0] = 0x30;  // SEQUENCE
  signature[1] = 68;     // Total length
  signature[2] = 0x02;  // INTEGER
  signature[3] = 32;     // r length
  signature.set(r, 4);
  signature[36] = 0x02; // INTEGER
  signature[37] = 32;    // s length
  signature.set(s, 38);
  
  return signature;
}

/**
 * Create complete mock WebAuthn assertion for Ed25519
 */
export function createMockEd25519Assertion(options: {
  challenge?: string;
  origin?: string;
  userPresent?: boolean;
  userVerified?: boolean;
} = {}): WebAuthnAssertion {
  return {
    authenticatorData: createMockAuthenticatorData({
      userPresent: options.userPresent,
      userVerified: options.userVerified
    }),
    clientDataJSON: createMockClientDataJSON({
      challenge: options.challenge,
      origin: options.origin,
      type: 'webauthn.get'
    }),
    signature: createMockEd25519Signature()
  };
}

/**
 * Create complete mock WebAuthn assertion for P-256
 */
export function createMockP256Assertion(options: {
  challenge?: string;
  origin?: string;
  userPresent?: boolean;
  userVerified?: boolean;
} = {}): WebAuthnAssertion {
  return {
    authenticatorData: createMockAuthenticatorData({
      userPresent: options.userPresent,
      userVerified: options.userVerified
    }),
    clientDataJSON: createMockClientDataJSON({
      challenge: options.challenge,
      origin: options.origin,
      type: 'webauthn.get'
    }),
    signature: createMockP256Signature()
  };
}

/**
 * Mock UCAN payload for testing challenge generation
 */
export function createMockUcanPayload(): Uint8Array {
  const payload = {
    iss: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    aud: 'did:web:up.storacha.network',
    att: [{ with: 'did:key:z6Mk...', can: 'upload/add' }],
    exp: Math.floor(Date.now() / 1000) + 86400
  };
  
  return new TextEncoder().encode(JSON.stringify(payload));
}
