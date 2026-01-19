/**
 * WebAuthn Varsig Unit Tests
 * 
 * Tests for encoder, decoder, and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  encodeWebAuthnVarsig,
  encodeWebAuthnVarsigV1,
  decodeWebAuthnVarsig,
  decodeWebAuthnVarsigV1,
  varintEncode,
  varintDecode,
  concat,
  base64urlToBytes,
  bytesToBase64url,
  bytesEqual,
  WEBAUTHN_ED25519,
  WEBAUTHN_P256,
  VARSIG_PREFIX,
  VARSIG_VERSION,
  INNER_EDDSA,
  INNER_ECDSA,
  CURVE_ED25519,
  CURVE_P256,
  MULTIHASH_SHA256,
  MULTIHASH_SHA256_LEN,
  WEBAUTHN_WRAPPER,
  PAYLOAD_ENCODING_RAW,
  isWebAuthnMulticodec,
  getAlgorithm,
  parseClientDataJSON
} from './index.js';
import {
  createMockEd25519Assertion,
  createMockP256Assertion,
  createMockAuthenticatorData,
  createMockClientDataJSON,
  createMockEd25519Signature,
  createMockP256Signature
} from './test-utils.js';

describe('Varint Encoding/Decoding', () => {
  it('should encode and decode small numbers', () => {
    const testCases = [0, 1, 127, 128, 255, 256, 1000, 10000];
    
    for (const num of testCases) {
      const encoded = varintEncode(num);
      const [decoded, bytesRead] = varintDecode(encoded);
      
      expect(decoded).toBe(num);
      expect(bytesRead).toBe(encoded.length);
    }
  });
  
  it('should encode 0xd1ed (WEBAUTHN_ED25519) correctly', () => {
    const encoded = varintEncode(0xd1ed);
    const [decoded] = varintDecode(encoded);
    
    expect(decoded).toBe(0xd1ed);
  });
  
  it('should handle varint with offset', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0x81, 0x01, 0xff]);
    const [decoded, bytesRead] = varintDecode(bytes, 2);
    
    expect(decoded).toBe(129);
    expect(bytesRead).toBe(2);
  });
  
  it('should throw on incomplete varint', () => {
    const incomplete = new Uint8Array([0x80, 0x80]); // Missing final byte
    
    expect(() => varintDecode(incomplete)).toThrow('Varint incomplete');
  });
});

describe('Utility Functions', () => {
  it('should concatenate arrays', () => {
    const arr1 = new Uint8Array([1, 2, 3]);
    const arr2 = new Uint8Array([4, 5]);
    const arr3 = new Uint8Array([6]);
    
    const result = concat([arr1, arr2, arr3]);
    
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });
  
  it('should convert between bytes and base64url', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 254]);
    const base64url = bytesToBase64url(original);
    const decoded = base64urlToBytes(base64url);
    
    expect(decoded).toEqual(original);
    expect(base64url).not.toContain('+');
    expect(base64url).not.toContain('/');
    expect(base64url).not.toContain('=');
  });
  
  it('should compare bytes correctly', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    const d = new Uint8Array([1, 2]);
    
    expect(bytesEqual(a, b)).toBe(true);
    expect(bytesEqual(a, c)).toBe(false);
    expect(bytesEqual(a, d)).toBe(false);
  });
});

describe('Multicodec Functions', () => {
  it('should identify WebAuthn multicodecs', () => {
    expect(isWebAuthnMulticodec(WEBAUTHN_ED25519)).toBe(true);
    expect(isWebAuthnMulticodec(WEBAUTHN_P256)).toBe(true);
    expect(isWebAuthnMulticodec(0xed)).toBe(false); // Standard Ed25519
    expect(isWebAuthnMulticodec(0x1200)).toBe(false); // Standard P-256
  });
  
  it('should get algorithm from multicodec', () => {
    expect(getAlgorithm(WEBAUTHN_ED25519)).toBe('Ed25519');
    expect(getAlgorithm(WEBAUTHN_P256)).toBe('P-256');
    expect(getAlgorithm(0xed)).toBe(null);
  });
});

describe('WebAuthn Varsig Encoder', () => {
  it('should encode Ed25519 assertion', () => {
    const assertion = createMockEd25519Assertion();
    const varsig = encodeWebAuthnVarsig(assertion, 'Ed25519');
    
    // Verify varsig is non-empty
    expect(varsig.length).toBeGreaterThan(0);
    
    // Verify it starts with WEBAUTHN_ED25519 multicodec
    const [multicodec] = varintDecode(varsig);
    expect(multicodec).toBe(WEBAUTHN_ED25519);
  });
  
  it('should encode P-256 assertion', () => {
    const assertion = createMockP256Assertion();
    const varsig = encodeWebAuthnVarsig(assertion, 'P-256');
    
    // Verify varsig is non-empty
    expect(varsig.length).toBeGreaterThan(0);
    
    // Verify it starts with WEBAUTHN_P256 multicodec
    const [multicodec] = varintDecode(varsig);
    expect(multicodec).toBe(WEBAUTHN_P256);
  });
  
  it('should include all assertion components', () => {
    const assertion = createMockEd25519Assertion();
    const varsig = encodeWebAuthnVarsig(assertion);
    
    // Varsig should be longer than any individual component
    expect(varsig.length).toBeGreaterThan(assertion.authenticatorData.length);
    expect(varsig.length).toBeGreaterThan(assertion.clientDataJSON.length);
    expect(varsig.length).toBeGreaterThan(assertion.signature.length);
  });
});

describe('WebAuthn Varsig Decoder', () => {
  it('should decode Ed25519 varsig', () => {
    const original = createMockEd25519Assertion();
    const varsig = encodeWebAuthnVarsig(original, 'Ed25519');
    const decoded = decodeWebAuthnVarsig(varsig);
    
    expect(decoded.multicodec).toBe(WEBAUTHN_ED25519);
    expect(bytesEqual(decoded.authenticatorData, original.authenticatorData)).toBe(true);
    expect(bytesEqual(decoded.clientDataJSON, original.clientDataJSON)).toBe(true);
    expect(bytesEqual(decoded.signature, original.signature)).toBe(true);
  });
  
  it('should decode P-256 varsig', () => {
    const original = createMockP256Assertion();
    const varsig = encodeWebAuthnVarsig(original, 'P-256');
    const decoded = decodeWebAuthnVarsig(varsig);
    
    expect(decoded.multicodec).toBe(WEBAUTHN_P256);
    expect(bytesEqual(decoded.authenticatorData, original.authenticatorData)).toBe(true);
    expect(bytesEqual(decoded.clientDataJSON, original.clientDataJSON)).toBe(true);
    expect(bytesEqual(decoded.signature, original.signature)).toBe(true);
  });
  
  it('should throw on invalid multicodec', () => {
    // Create varsig with standard Ed25519 multicodec (0xed) instead of WebAuthn
    const assertion = createMockEd25519Assertion();
    const fakeVarsig = concat([
      varintEncode(0xed), // Wrong multicodec
      varintEncode(assertion.authenticatorData.length),
      assertion.authenticatorData,
      varintEncode(assertion.clientDataJSON.length),
      assertion.clientDataJSON,
      assertion.signature
    ]);
    
    expect(() => decodeWebAuthnVarsig(fakeVarsig)).toThrow('Unsupported multicodec');
  });
  
  it('should throw on empty signature', () => {
    const assertion = createMockEd25519Assertion();
    const fakeVarsig = concat([
      varintEncode(WEBAUTHN_ED25519),
      varintEncode(assertion.authenticatorData.length),
      assertion.authenticatorData,
      varintEncode(assertion.clientDataJSON.length),
      assertion.clientDataJSON,
      new Uint8Array(0)
    ]);

    expect(() => decodeWebAuthnVarsig(fakeVarsig)).toThrow('Signature is empty');
  });
  
  it('should throw on truncated data', () => {
    const assertion = createMockEd25519Assertion();
    const varsig = encodeWebAuthnVarsig(assertion);
    
    // Truncate the varsig
    const truncated = varsig.slice(0, 50);
    
    expect(() => decodeWebAuthnVarsig(truncated)).toThrow();
  });
});

describe('WebAuthn Varsig v1 Encoder/Decoder', () => {
  it('should encode and decode Ed25519 varsig v1', () => {
    const assertion = createMockEd25519Assertion();
    const varsig = encodeWebAuthnVarsigV1(assertion, 'Ed25519');
    const decoded = decodeWebAuthnVarsigV1(varsig);

    expect(varsig[0]).toBe(VARSIG_PREFIX);
    expect(varsig[1]).toBe(VARSIG_VERSION);
    expect(decoded.innerAlgorithm).toBe(INNER_EDDSA);
    expect(decoded.curve).toBe(CURVE_ED25519);
    expect(decoded.multihashCode).toBe(MULTIHASH_SHA256);
    expect(decoded.multihashLength).toBe(MULTIHASH_SHA256_LEN);
    expect(decoded.webauthnMarker).toBe(WEBAUTHN_WRAPPER);
    expect(decoded.payloadEncoding).toBe(PAYLOAD_ENCODING_RAW);
    expect(bytesEqual(decoded.authenticatorData, assertion.authenticatorData)).toBe(true);
    expect(bytesEqual(decoded.clientDataJSON, assertion.clientDataJSON)).toBe(true);
    expect(bytesEqual(decoded.signature, assertion.signature)).toBe(true);
  });

  it('should encode and decode P-256 varsig v1', () => {
    const assertion = createMockP256Assertion();
    const varsig = encodeWebAuthnVarsigV1(assertion, 'P-256');
    const decoded = decodeWebAuthnVarsigV1(varsig);

    expect(decoded.innerAlgorithm).toBe(INNER_ECDSA);
    expect(decoded.curve).toBe(CURVE_P256);
    expect(decoded.algorithm).toBe('P-256');
  });

  it('should reject non-v1 varsig header', () => {
    const assertion = createMockEd25519Assertion();
    const varsig = encodeWebAuthnVarsigV1(assertion, 'Ed25519');
    const corrupted = varsig.slice();
    corrupted[0] = 0x00;

    expect(() => decodeWebAuthnVarsigV1(corrupted)).toThrow('Unsupported varsig header');
  });
});

describe('Round-trip Encoding/Decoding', () => {
  it('should perfectly round-trip Ed25519 assertion', () => {
    const original = createMockEd25519Assertion({
      challenge: 'test-challenge-123',
      origin: 'https://test.example.com',
      userPresent: true,
      userVerified: true
    });
    
    const varsig = encodeWebAuthnVarsig(original, 'Ed25519');
    const decoded = decodeWebAuthnVarsig(varsig);
    
    expect(bytesEqual(decoded.authenticatorData, original.authenticatorData)).toBe(true);
    expect(bytesEqual(decoded.clientDataJSON, original.clientDataJSON)).toBe(true);
    expect(bytesEqual(decoded.signature, original.signature)).toBe(true);
  });
  
  it('should perfectly round-trip P-256 assertion', () => {
    const original = createMockP256Assertion({
      challenge: 'another-challenge-456',
      origin: 'https://app.example.org'
    });
    
    const varsig = encodeWebAuthnVarsig(original, 'P-256');
    const decoded = decodeWebAuthnVarsig(varsig);
    
    expect(bytesEqual(decoded.authenticatorData, original.authenticatorData)).toBe(true);
    expect(bytesEqual(decoded.clientDataJSON, original.clientDataJSON)).toBe(true);
    expect(bytesEqual(decoded.signature, original.signature)).toBe(true);
  });
});

describe('ClientDataJSON Parsing', () => {
  it('should parse clientDataJSON correctly', () => {
    const clientDataJSON = createMockClientDataJSON({
      challenge: 'test-challenge',
      origin: 'https://example.com',
      type: 'webauthn.get'
    });
    
    const parsed = parseClientDataJSON(clientDataJSON);
    
    expect(parsed.type).toBe('webauthn.get');
    expect(parsed.challenge).toBe('test-challenge');
    expect(parsed.origin).toBe('https://example.com');
    expect(parsed.crossOrigin).toBe(false);
  });
  
  it('should throw on invalid JSON', () => {
    const invalidJSON = new TextEncoder().encode('not valid json{]');
    
    expect(() => parseClientDataJSON(invalidJSON)).toThrow('Failed to parse clientDataJSON');
  });
});

describe('Mock Data Validation', () => {
  it('should create valid authenticatorData', () => {
    const authData = createMockAuthenticatorData();
    
    expect(authData.length).toBeGreaterThanOrEqual(37);
    
    // Check flags
    const flags = authData[32];
    expect(flags & 0x01).toBeTruthy(); // UP flag
    expect(flags & 0x04).toBeTruthy(); // UV flag
  });
  
  it('should create Ed25519 signature of correct length', () => {
    const signature = createMockEd25519Signature();
    
    expect(signature.length).toBe(64);
  });
  
  it('should create P-256 signature in DER format', () => {
    const signature = createMockP256Signature();
    
    expect(signature.length).toBeGreaterThanOrEqual(70);
    expect(signature[0]).toBe(0x30); // SEQUENCE tag
  });
});
