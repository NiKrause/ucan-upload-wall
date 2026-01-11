/**
 * WebAuthn Ed25519 Varsig Signer
 * 
 * Signs UCANs using hardware-backed WebAuthn Ed25519 credentials
 * with varsig encoding for verification
 */

import {
  encodeWebAuthnVarsig,
  type WebAuthnAssertion
} from './webauthn-varsig/index.js';

/**
 * WebAuthn Ed25519 signer for UCAN
 */
export class WebAuthnEd25519Signer {
  private credentialId: BufferSource;
  public did: string;
  public publicKey: Uint8Array;
  
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
    const challengeHash = await crypto.subtle.digest('SHA-256', payloadCopy);
    const challenge = new Uint8Array(challengeHash);
    
    console.log('🔐 Requesting WebAuthn signature (biometric required)...');
    
    // Get WebAuthn assertion
    const assertion = await navigator.credentials.get({
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
    }) as PublicKeyCredential | null;
    
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
    const varsig = encodeWebAuthnVarsig(webauthnAssertion, 'Ed25519');
    
    console.log('📦 Encoded as varsig:', varsig.length, 'bytes');
    
    return varsig;
  }
  
  /**
   * Get DID string
   */
  getDid(): string {
    return this.did;
  }
  
  /**
   * Convert to ucanto-compatible signer interface
   */
  toUcantoSigner() {
    return {
      did: () => this.did,
      sign: async (data: Uint8Array) => this.sign(data),
      // WebAuthn doesn't support key export
      export: () => {
        throw new Error('Cannot export WebAuthn hardware-backed keys');
      }
    };
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
 * 
 * @param userId - User identifier
 * @param displayName - User display name
 * @param options - Optional configuration for authenticator preferences
 * @returns Signer instance or null if creation failed
 */
export async function createWebAuthnEd25519Credential(
  userId: string,
  displayName: string,
  options: WebAuthnCredentialOptions = {}
): Promise<WebAuthnEd25519Signer | null> {
  const { authenticatorType = 'any' } = options;
  
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
        pubKeyCredParams: [
          { type: 'public-key', alg: -8 },   // EdDSA (Ed25519) - PREFERRED
          { type: 'public-key', alg: -7 },   // ES256 (P-256) - fallback
          { type: 'public-key', alg: -257 }  // RS256 (RSA) - broad compatibility
        ],
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
    const publicKey = await extractEd25519PublicKey(
      new Uint8Array(response.attestationObject)
    );
    
    if (!publicKey) {
      console.log('💡 Authenticator does not support Ed25519. This is expected on most devices.');
      console.log('   Supported authenticators:');
      console.log('   Platform (built-in):');
      console.log('   • Chrome 108+ on Windows 11 22H2+ (TPM 2.0)');
      console.log('   • Safari 17+ on macOS 14+ with Apple Silicon M1/M2/M3 (Secure Enclave)');
      console.log('   • Edge 108+ on Windows 11 22H2+ (TPM 2.0)');
      console.log('   External Security Keys (USB/NFC):');
      console.log('   • YubiKey 5 Series with Ed25519 support');
      console.log('   • Ledger Nano S/X/Plus (may support Ed25519 via FIDO2)');
      console.log('   • Other FIDO2 keys with Ed25519 capability');
      console.log('   Worker mode (with PRF encryption) will be used instead.');
      throw new Error('Failed to extract Ed25519 public key from credential');
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
      algName: alg === -8 ? 'EdDSA' : alg === -7 ? 'ES256' : alg === -257 ? 'RS256' : `Unknown (${alg})`,
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
    
    if (alg !== -8) {
      const algName = alg === -7 ? 'ES256 (P-256)' : alg === -257 ? 'RS256 (RSA)' : `algorithm ${alg}`;
      console.warn(`⚠️ Authenticator used ${algName} instead of EdDSA`);
      console.log('💡 This authenticator does not support EdDSA. Falling back to worker mode.');
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
 * Check if browser supports WebAuthn Ed25519
 */
export async function checkEd25519Support(): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    return false;
  }
  
  // Try to check if Ed25519 is supported
  // Note: Not all browsers expose this, so we may need to try creating a credential
  try {
    // Check if platform authenticator is available
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    
    // Ed25519 support started in:
    // - Chrome 108+
    // - Safari 17+ (macOS 14+, iOS 17+)
    // - Firefox (limited)
    
    return available;
  } catch {
    return false;
  }
}
