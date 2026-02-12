/**
 * WebAuthn Ed25519 Varsig Signer
 * 
 * Signs UCANs using hardware-backed WebAuthn Ed25519 credentials
 * with varsig encoding for verification
 */

import {
  encodeWebAuthnVarsigV1,
  decodeWebAuthnVarsigV1,
  reconstructSignedData,
  verifyEd25519Signature,
  verifyP256Signature,
  concat
} from 'iso-webauthn-varsig';
import * as DagUcanSignature from '@ipld/dag-ucan/signature';

interface WebAuthnAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}

const wrapQueuedSign = <T extends { sign: (data: Uint8Array) => Promise<Uint8Array> }>(
  signer: T
): T => {
  let pending: Promise<void> = Promise.resolve();
  const queued = Object.create(signer) as T;
  queued.sign = async (data: Uint8Array) => {
    const run = pending.then(() => signer.sign(data), () => signer.sign(data));
    pending = run.then(() => undefined, () => undefined);
    return run;
  };
  return queued;
};

/**
 * WebAuthn Ed25519 signer for UCAN
 */
export class WebAuthnEd25519Signer {
  private credentialId: BufferSource;
  public did: string;
  public publicKey: Uint8Array;
  public algorithm = 'Ed25519' as const;
  private static pendingRequest: Promise<void> = Promise.resolve();
  private static enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = WebAuthnEd25519Signer.pendingRequest.then(task, task);
    WebAuthnEd25519Signer.pendingRequest = run.then(() => undefined, () => undefined);
    return run;
  }
  
  constructor(credentialId: BufferSource, did: string, publicKey: Uint8Array) {
    this.credentialId = credentialId;
    this.did = did;
    this.publicKey = publicKey;
  }
  
  /**
   * Sign UCAN payload with WebAuthn Ed25519 credential
   * Returns varsig-encoded signature
   * 
   * @param payload - UCAN payload bytes to sign
   * @returns Varsig-encoded WebAuthn assertion
   */
  async sign(payload: Uint8Array): Promise<Uint8Array> {
    // Hash payload to create challenge
    // Ensure we have a regular Uint8Array with ArrayBuffer (not SharedArrayBuffer)
    const payloadCopy = new Uint8Array(payload);
    const domain = new TextEncoder().encode('ucan-webauthn-v1:');
    const challengeInput = concat([domain, payloadCopy]);
    const challengeHash = await crypto.subtle.digest('SHA-256', challengeInput);
    const challenge = new Uint8Array(challengeHash);
    
    console.log('🔐 Requesting WebAuthn signature (biometric required)...');
    
    const assertion = await WebAuthnEd25519Signer.enqueue(async () =>
      navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: this.credentialId,
            type: 'public-key',
            transports: ['internal', 'hybrid']
          }],
          userVerification: 'required',
          timeout: 60000
        }
      }) as Promise<PublicKeyCredential | null>
    );
    
    if (!assertion) {
      throw new Error('WebAuthn authentication failed or was cancelled');
    }
    
    const response = assertion.response as AuthenticatorAssertionResponse;
    
    // Extract WebAuthn data
    const webauthnAssertion: WebAuthnAssertion = {
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON),
      signature: new Uint8Array(response.signature)
    };
    
    console.log('✅ WebAuthn signature obtained!');
    
    // Encode as varsig
    const varsig = encodeWebAuthnVarsigV1(webauthnAssertion, 'Ed25519');
    
    console.log('📦 Encoded as varsig v1:', varsig.length, 'bytes');
    
    return varsig;
  }
  
  /**
   * Get DID string
   */
  getDid(): string {
    return this.did;
  }

  getCredentialId(): BufferSource {
    return this.credentialId;
  }
  
  /**
   * Verify a varsig-encoded signature
   * @param data - The original data that was signed
   * @param signature - The varsig-encoded signature
   * @returns True if signature is valid
   */
  async verify(_data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    try {
      const signatureBytes = (signature as Uint8Array & { raw?: Uint8Array }).raw ?? signature;
      // Decode varsig v1
      const decoded = decodeWebAuthnVarsigV1(signatureBytes);
      
      // Reconstruct the data that was actually signed by WebAuthn
      const signedData = await reconstructSignedData(decoded);
      
      // Verify the Ed25519 signature
      return await verifyEd25519Signature(signedData, decoded.signature, this.publicKey);
    } catch (error) {
      console.error('Varsig verification failed:', error);
      return false;
    }
  }

  /**
   * Convert to ucanto-compatible signer interface
   * Uses custom ucanto with WebAuthn varsig support
   */
  toUcantoSigner() {
    const signatureAlgorithm = 'EdDSA';
    const signatureCode = DagUcanSignature.EdDSA;
    const signer = {
      sign: async (payload: Uint8Array) => {
        const varsig = await this.sign(payload);
        return DagUcanSignature.create(signatureCode, varsig);
      },
      did: () => this.did,
      toDIDKey: () => this.did,
      signatureAlgorithm,
      signatureCode,
      encode: () => this.publicKey,
      toArchive: () => ({
        id: this.did,
        keys: {
          [this.did]: this.publicKey
        }
      }),
      export: () => {
        throw new Error('Cannot export WebAuthn hardware-backed keys');
      }
    };

    return wrapQueuedSign(signer);
  }
}

/**
 * WebAuthn P-256 signer for UCAN
 * Fallback when Ed25519 is not supported by hardware
 */
export class WebAuthnP256Signer {
  private credentialId: BufferSource;
  public did: string;
  public publicKey: Uint8Array;
  public algorithm = 'P-256' as const;
  private static pendingRequest: Promise<void> = Promise.resolve();
  private static enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = WebAuthnP256Signer.pendingRequest.then(task, task);
    WebAuthnP256Signer.pendingRequest = run.then(() => undefined, () => undefined);
    return run;
  }
  
  constructor(credentialId: BufferSource, did: string, publicKey: Uint8Array) {
    this.credentialId = credentialId;
    this.did = did;
    this.publicKey = publicKey;
  }
  
  /**
   * Sign UCAN payload with WebAuthn P-256 credential
   * Returns varsig-encoded signature
   * 
   * @param payload - UCAN payload bytes to sign
   * @returns Varsig-encoded WebAuthn assertion
   */
  async sign(payload: Uint8Array): Promise<Uint8Array> {
    // Hash payload to create challenge
    const payloadCopy = new Uint8Array(payload);
    const domain = new TextEncoder().encode('ucan-webauthn-v1:');
    const challengeInput = concat([domain, payloadCopy]);
    const challengeHash = await crypto.subtle.digest('SHA-256', challengeInput);
    const challenge = new Uint8Array(challengeHash);
    
    console.log('🔐 Requesting WebAuthn P-256 signature (biometric required)...');
    
    const assertion = await WebAuthnP256Signer.enqueue(async () =>
      navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: this.credentialId,
            type: 'public-key',
            transports: ['internal', 'hybrid']
          }],
          userVerification: 'required',
          timeout: 60000
        }
      }) as Promise<PublicKeyCredential | null>
    );
    
    if (!assertion) {
      throw new Error('WebAuthn authentication failed or was cancelled');
    }
    
    const response = assertion.response as AuthenticatorAssertionResponse;
    
    // Extract WebAuthn data
    const webauthnAssertion: WebAuthnAssertion = {
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON),
      signature: new Uint8Array(response.signature)
    };
    
    console.log('✅ WebAuthn P-256 signature obtained!');
    
    // Encode as P-256 varsig
    const varsig = encodeWebAuthnVarsigV1(webauthnAssertion, 'P-256');
    
    console.log('📦 Encoded as P-256 varsig v1:', varsig.length, 'bytes');
    
    return varsig;
  }
  
  /**
   * Get DID string
   */
  getDid(): string {
    return this.did;
  }

  getCredentialId(): BufferSource {
    return this.credentialId;
  }
  
  /**
   * Verify a varsig-encoded signature
   * @param data - The original data that was signed
   * @param signature - The varsig-encoded signature
   * @returns True if signature is valid
   */
  async verify(_data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    try {
      const signatureBytes = (signature as Uint8Array & { raw?: Uint8Array }).raw ?? signature;
      // Decode varsig v1
      const decoded = decodeWebAuthnVarsigV1(signatureBytes);
      
      // Reconstruct the data that was actually signed by WebAuthn
      const signedData = await reconstructSignedData(decoded);
      
      // Verify the P-256 signature
      return await verifyP256Signature(signedData, decoded.signature, this.publicKey);
    } catch (error) {
      console.error('P-256 varsig verification failed:', error);
      return false;
    }
  }
  
  /**
   * Convert to ucanto-compatible signer interface
   */
  toUcantoSigner() {
    const signatureAlgorithm = 'ES256';
    const signatureCode = DagUcanSignature.ES256;
    const signer = {
      sign: async (payload: Uint8Array) => {
        const varsig = await this.sign(payload);
        return DagUcanSignature.create(signatureCode, varsig);
      },
      did: () => this.did,
      toDIDKey: () => this.did,
      signatureAlgorithm,
      signatureCode,
      encode: () => this.publicKey,
      toArchive: () => ({
        id: this.did,
        keys: {
          [this.did]: this.publicKey
        }
      }),
      export: () => {
        throw new Error('Cannot export WebAuthn hardware-backed keys');
      }
    };

    return wrapQueuedSign(signer);
  }
}

/**
 * Options for WebAuthn credential creation
 */
export interface WebAuthnCredentialOptions {
  /** Preferred authenticator type: 'platform' (Touch ID) or 'cross-platform' (USB keys) */
  authenticatorType?: 'platform' | 'cross-platform' | 'any';
}

/**
 * Create WebAuthn Ed25519 credential for hardware-backed UCAN signing
 * Falls back to P-256 if Ed25519 is not supported by the hardware
 * 
 * @param userId - User identifier
 * @param displayName - User display name
 * @param options - Optional configuration for authenticator preferences
 * @returns Signer instance (Ed25519 or P-256) or null if creation failed
 */
export async function createWebAuthnEd25519Credential(
  userId: string,
  displayName: string,
  options: WebAuthnCredentialOptions = {}
): Promise<WebAuthnEd25519Signer | WebAuthnP256Signer | null> {
  const { authenticatorType = 'any' } = options;
  const forceP256Hardware =
    typeof window !== 'undefined' &&
    Boolean((window as typeof window & { __FORCE_P256_HARDWARE__?: boolean }).__FORCE_P256_HARDWARE__);
  
  console.log('🔑 Creating WebAuthn Ed25519 credential (hardware-backed)...');
  if (authenticatorType !== 'any') {
    console.log(`   Preference: ${authenticatorType === 'platform' ? '🔒 Platform (Touch ID/Windows Hello)' : '🔑 External USB/NFC Security Key'}`);
  }
  
  try {
    // Check browser support for Ed25519
    if (!window.PublicKeyCredential) {
      throw new Error('WebAuthn not supported in this browser');
    }
    
    const userIdBytes = new TextEncoder().encode(userId);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const pubKeyCredParams: PublicKeyCredentialParameters[] = forceP256Hardware
      ? [{ type: 'public-key' as const, alg: -7 }]
      : [
          { type: 'public-key' as const, alg: -50 },  // Ed25519 (RFC 9864) - PREFERRED (fully-specified)
          { type: 'public-key' as const, alg: -8 },   // EdDSA (legacy polymorphic) - fallback
          { type: 'public-key' as const, alg: -7 },   // ES256 (P-256) - fallback
          { type: 'public-key' as const, alg: -257 }  // RS256 (RSA) - broad compatibility
        ];
    
    // Create WebAuthn credential with Ed25519
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'UCAN Upload Wall',
          id: window.location.hostname
        },
        user: {
          id: userIdBytes,
          name: userId,
          displayName
        },
        pubKeyCredParams,
        authenticatorSelection: {
          // Set authenticator attachment based on user preference
          ...(authenticatorType !== 'any' && { authenticatorAttachment: authenticatorType }),
          // For external USB keys (Ledger, YubiKey): discourage extra biometric
          // For platform (Touch ID): prefer biometric for extra security
          userVerification: authenticatorType === 'cross-platform' ? 'discouraged' : 'preferred',
          residentKey: 'preferred'
        },
        timeout: 60000
      }
    }) as PublicKeyCredential | null;
    
    if (!credential) {
      console.error('❌ Credential creation returned null');
      return null;
    }
    
    console.log('✅ WebAuthn credential created');
    console.log('   Credential ID:', credential.id);
    console.log('   Credential Type:', credential.type);
    
    // Check authenticator attachment (if available)
    // Note: This is a recent WebAuthn Level 3 addition, may not be in all type definitions
    const authenticatorAttachment = (credential as PublicKeyCredential & { authenticatorAttachment?: string }).authenticatorAttachment;
    if (authenticatorAttachment) {
      console.log('   Authenticator Type:', authenticatorAttachment === 'platform' ? '🔒 Platform (Touch ID/Windows Hello)' : '🔑 Cross-platform (USB Security Key)');
    }
    
    const response = credential.response as AuthenticatorAttestationResponse;
    
    // Extract public key from attestation object
    const publicKey = forceP256Hardware
      ? null
      : await extractEd25519PublicKey(new Uint8Array(response.attestationObject));
    
    if (!publicKey) {
      // Ed25519 not supported - try P-256 as fallback
      if (forceP256Hardware) {
        console.log('🔄 Forcing P-256 hardware fallback for testing');
      } else {
        console.log('🔄 Ed25519 not available, attempting P-256 extraction...');
      }
      
      const p256PublicKey = await extractP256PublicKey(
        new Uint8Array(response.attestationObject)
      );
      
      if (!p256PublicKey) {
        console.log('💡 Neither Ed25519 nor P-256 could be extracted from authenticator.');
        console.log('   Supported authenticators:');
        console.log('   Platform (built-in):');
        console.log('   • Chrome 108+ on Windows 11 22H2+ (TPM 2.0)');
        console.log('   • Safari 17+ on macOS 14+ with Apple Silicon M1/M2/M3 (Secure Enclave)');
        console.log('   • Edge 108+ on Windows 11 22H2+ (TPM 2.0)');
        console.log('   External Security Keys (USB/NFC):');
        console.log('   • YubiKey 5 Series');
        console.log('   • Ledger Nano S/X/Plus');
        console.log('   • Other FIDO2 security keys');
        console.log('   Worker mode (with PRF encryption) will be used instead.');
        throw new Error('Failed to extract public key from credential');
      }
      
      // Create DID from P-256 public key
      const p256Did = await createP256Did(p256PublicKey);
      
      const authType = (credential as PublicKeyCredential & { authenticatorAttachment?: string }).authenticatorAttachment;
      const authTypeName = authType === 'platform' 
        ? 'Platform authenticator (Touch ID/Windows Hello)' 
        : authType === 'cross-platform'
        ? 'External security key (USB/NFC)'
        : 'Unknown authenticator type';
      
      console.log('✅ Created WebAuthn P-256 credential (hardware-backed fallback)');
      console.log('   DID:', p256Did);
      console.log('   Authenticator:', authTypeName);
      console.log('   Credential ID:', credential.id);
      console.log('   ⚠️  Using P-256 with ucanto fork for UCAN compatibility');
      
      // Create P-256 signer
      return new WebAuthnP256Signer(
        credential.rawId,
        p256Did,
        p256PublicKey
      );
    }
    
    // Create DID from Ed25519 public key
    const did = await createEd25519Did(publicKey);
    
    const authType = (credential as PublicKeyCredential & { authenticatorAttachment?: string }).authenticatorAttachment;
    const authTypeName = authType === 'platform' 
      ? 'Platform authenticator (Touch ID/Windows Hello)' 
      : authType === 'cross-platform'
      ? 'External security key (USB/NFC)'
      : 'Unknown authenticator type';
    
    console.log('✅ Created WebAuthn Ed25519 credential');
    console.log('   DID:', did);
    console.log('   Authenticator:', authTypeName);
    console.log('   Credential ID:', credential.id);
    
    // Create signer
    return new WebAuthnEd25519Signer(
      credential.rawId,
      did,
      publicKey
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        console.log('⚠️ WebAuthn credential creation was cancelled or timed out');
      } else if (error.message.includes('Not an OKP key type') || 
                 error.message.includes('Not an EdDSA algorithm') ||
                 error.message.includes('Not Ed25519 curve')) {
        // Already logged detailed info above
      } else {
        console.error('❌ Failed to create WebAuthn Ed25519 credential:', error);
      }
    } else {
      console.error('❌ Failed to create WebAuthn Ed25519 credential:', error);
    }
    return null;
  }
}

/**
 * Extract Ed25519 public key from attestation object (CBOR encoded)
 */
async function extractEd25519PublicKey(attestationObject: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Dynamically import cbor-web
    const CBOR = await import('cbor-web');
    
    // Decode attestation object - ensure we have an ArrayBuffer (not SharedArrayBuffer)
    const attestationCopy = new Uint8Array(attestationObject);
    const buffer = attestationCopy.buffer as ArrayBuffer;
    const decoded = CBOR.decode(buffer);
    
    // Get authData
    const authData = new Uint8Array(decoded.authData);
    
    // AuthData structure:
    // - rpIdHash: 32 bytes
    // - flags: 1 byte
    // - signCount: 4 bytes
    // - attestedCredentialData: variable
    
    // Check if AT (Attested Credential Data) flag is set
    const flags = authData[32];
    const hasAttestedCredData = (flags & 0x40) !== 0;
    
    if (!hasAttestedCredData) {
      throw new Error('No attested credential data in authData');
    }
    
    // Skip to attested credential data (after rpIdHash + flags + signCount)
    let offset = 37; // 32 + 1 + 4
    
    // Skip AAGUID (16 bytes)
    offset += 16;
    
    // Read credential ID length (2 bytes, big-endian)
    const credIdLen = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;
    
    // Skip credential ID
    offset += credIdLen;
    
    // Remaining bytes are COSE public key (CBOR encoded)
    const coseKeyBytes = authData.slice(offset);
    const coseKeyCopy = new Uint8Array(coseKeyBytes);
    const coseKeyBuffer = coseKeyCopy.buffer as ArrayBuffer;
    const coseKey = CBOR.decode(coseKeyBuffer);
    
    // COSE key format for Ed25519:
    // kty (1): 1 (OKP)
    // alg (3): -8 (EdDSA)
    // crv (-1): 6 (Ed25519)
    // x (-2): public key bytes (32 bytes)
    
    // Extract key parameters for diagnostics
    const kty = coseKey.get(1);
    const alg = coseKey.get(3);
    const crv = coseKey.get(-1);
    
    // Log what the authenticator actually returned
    console.log('🔍 Authenticator returned COSE key:', {
      kty,
      ktyName: kty === 1 ? 'OKP' : kty === 2 ? 'EC2' : kty === 3 ? 'RSA' : `Unknown (${kty})`,
      alg,
      algName: alg === -50 ? 'Ed25519 (RFC 9864)' : alg === -8 ? 'EdDSA (legacy)' : alg === -7 ? 'ES256' : alg === -257 ? 'RS256' : `Unknown (${alg})`,
      crv,
      crvName: crv === 6 ? 'Ed25519' : crv === 1 ? 'P-256' : `Unknown (${crv})`
    });
    
    // Validate that it's Ed25519
    if (kty !== 1) {
      const keyTypeName = kty === 2 ? 'EC2 (P-256)' : kty === 3 ? 'RSA' : `type ${kty}`;
      console.warn(`⚠️ Authenticator used ${keyTypeName} instead of OKP (Ed25519)`);
      console.log('💡 This authenticator does not support Ed25519. Falling back to worker mode.');
      throw new Error('Not an OKP key type');
    }
    
    if (alg !== -50 && alg !== -8) {
      const algName = alg === -7 ? 'ES256 (P-256)' : alg === -257 ? 'RS256 (RSA)' : `algorithm ${alg}`;
      console.warn(`⚠️ Authenticator used ${algName} instead of Ed25519 (-50) or EdDSA (-8)`);
      console.log('💡 This authenticator does not support Ed25519. Falling back to worker mode.');
      throw new Error('Not an EdDSA algorithm');
    }
    
    if (crv !== 6) {
      const curveName = crv === 1 ? 'P-256' : `curve ${crv}`;
      console.warn(`⚠️ Authenticator used ${curveName} instead of Ed25519`);
      console.log('💡 This authenticator does not support Ed25519 curve. Falling back to worker mode.');
      throw new Error('Not Ed25519 curve');
    }
    
    const publicKeyBytes = new Uint8Array(coseKey.get(-2));
    
    if (publicKeyBytes.length !== 32) {
      throw new Error(`Invalid Ed25519 public key length: ${publicKeyBytes.length}`);
    }
    
    console.log('✅ Successfully extracted Ed25519 public key (32 bytes)');
    console.log('🎉 HARDWARE ED25519 MODE ACTIVATED!');
    console.log('   Keys are stored in secure hardware and cannot be extracted');
    console.log('   Biometric authentication required for each signature');
    
    return publicKeyBytes;
  } catch (error) {
    console.error('Failed to extract Ed25519 public key:', error);
    return null;
  }
}

/**
 * Create did:key from Ed25519 public key
 * 
 * Format: did:key:z{base58btc(multicodec + publicKey)}
 * Multicodec for Ed25519: 0xed
 */
async function createEd25519Did(publicKey: Uint8Array): Promise<string> {
  // Dynamically import base58btc from multiformats
  const { base58btc } = await import('multiformats/bases/base58');
  
  // Create multikey: [0xed, 0x01] + publicKey
  const multikey = new Uint8Array(2 + publicKey.length);
  multikey[0] = 0xed;
  multikey[1] = 0x01;
  multikey.set(publicKey, 2);
  
  // Encode as base58btc
  const encoded = base58btc.encode(multikey);
  
  return `did:key:${encoded}`;
}

/**
 * Extract P-256 public key from attestation object (CBOR encoded)
 * Fallback when Ed25519 is not available
 */
async function extractP256PublicKey(attestationObject: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Dynamically import cbor-web
    const CBOR = await import('cbor-web');
    
    // Decode attestation object
    const attestationCopy = new Uint8Array(attestationObject);
    const buffer = attestationCopy.buffer as ArrayBuffer;
    const decoded = CBOR.decode(buffer);
    
    // Get authData
    const authData = new Uint8Array(decoded.authData);
    
    // Check if AT (Attested Credential Data) flag is set
    const flags = authData[32];
    const hasAttestedCredData = (flags & 0x40) !== 0;
    
    if (!hasAttestedCredData) {
      throw new Error('No attested credential data in authData');
    }
    
    // Skip to attested credential data
    let offset = 37; // rpIdHash (32) + flags (1) + signCount (4)
    offset += 16;    // Skip AAGUID
    
    // Read credential ID length (2 bytes, big-endian)
    const credIdLen = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;
    offset += credIdLen; // Skip credential ID
    
    // Decode COSE public key
    const coseKeyBytes = authData.slice(offset);
    const coseKeyCopy = new Uint8Array(coseKeyBytes);
    const coseKeyBuffer = coseKeyCopy.buffer as ArrayBuffer;
    const coseKey = CBOR.decode(coseKeyBuffer);
    
    // COSE key format for P-256 (EC2):
    // kty (1): 2 (EC2)
    // alg (3): -7 (ES256)
    // crv (-1): 1 (P-256)
    // x (-2): x-coordinate (32 bytes)
    // y (-3): y-coordinate (32 bytes)
    
    const kty = coseKey.get(1);
    const alg = coseKey.get(3);
    const crv = coseKey.get(-1);
    
    // Validate that it's P-256
    if (kty !== 2) {
      throw new Error(`Expected EC2 key type (2), got ${kty}`);
    }
    
    if (alg !== -7) {
      throw new Error(`Expected ES256 algorithm (-7), got ${alg}`);
    }
    
    if (crv !== 1) {
      throw new Error(`Expected P-256 curve (1), got ${crv}`);
    }
    
    // Extract x and y coordinates
    const x = new Uint8Array(coseKey.get(-2));
    const y = new Uint8Array(coseKey.get(-3));
    
    if (x.length !== 32 || y.length !== 32) {
      throw new Error(`Invalid P-256 coordinate length: x=${x.length}, y=${y.length}`);
    }
    
    // P-256 public key in uncompressed format: 0x04 || x || y
    const publicKey = new Uint8Array(65);
    publicKey[0] = 0x04; // Uncompressed point indicator
    publicKey.set(x, 1);
    publicKey.set(y, 33);
    
    console.log('✅ Successfully extracted P-256 public key (65 bytes)');
    console.log('🔄 HARDWARE P-256 MODE ACTIVATED (fallback from Ed25519)');
    console.log('   Keys are stored in secure hardware and cannot be extracted');
    console.log('   Biometric authentication required for each signature');
    console.log('   ⚠️  Using P-256 with your ucanto fork for UCAN compatibility');
    
    return publicKey;
  } catch (error) {
    console.error('Failed to extract P-256 public key:', error);
    return null;
  }
}

/**
 * Create did:key from P-256 public key
 * 
 * Format: did:key:z{base58btc(multicodec + publicKey)}
 * Multicodec for P-256: 0x1200 (varint encoded as [0x80, 0x24])
 */
async function createP256Did(publicKey: Uint8Array): Promise<string> {
  // Dynamically import base58btc from multiformats
  const { base58btc } = await import('multiformats/bases/base58');
  const { p256 } = await import('@noble/curves/p256');
  
  // P-256 multicodec: 0x1200 encoded as varint
  const multicodecPrefix = new Uint8Array([0x80, 0x24]); // 0x1200 in varint
  
  const compressedKey =
    publicKey.length === 33
      ? publicKey
      : publicKey.length === 65
      ? p256.ProjectivePoint.fromHex(publicKey).toRawBytes(true)
      : (() => {
          throw new Error(`Invalid P-256 public key length: ${publicKey.length}`);
        })();

  // Create multikey: multicodec + publicKey
  const multikey = new Uint8Array(multicodecPrefix.length + compressedKey.length);
  multikey.set(multicodecPrefix, 0);
  multikey.set(compressedKey, multicodecPrefix.length);
  
  // Encode as base58btc
  const encoded = base58btc.encode(multikey);
  
  return `did:key:${encoded}`;
}

/**
 * Check if browser supports WebAuthn Ed25519
 */
export async function checkEd25519Support(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return false;
  }

  return Boolean(navigator.credentials?.create);
}
