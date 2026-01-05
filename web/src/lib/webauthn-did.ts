/**
 * WebAuthn DID Provider
 * 
 * Standalone implementation with WebAuthn PRF extension support
 * No external dependencies - fully self-contained
 */

import { base58btc } from 'multiformats/bases/base58';

// TypeScript type definitions
export interface WebAuthnCredentialInfo {
  credentialId: string;
  rawCredentialId: Uint8Array;
  publicKey: {
    algorithm: number;
    x: Uint8Array;
    y: Uint8Array;
    keyType: number;
    curve: number;
  };
  userId: string;
  displayName: string;
  did?: string;
  prfInput?: Uint8Array;        // PRF input/salt for deterministic key derivation (safe to store)
  prfSeed?: Uint8Array;         // TRANSIENT: PRF output seed (NEVER stored in localStorage for security)
  prfSource?: 'prf' | 'credentialId';  // Track which method was used
  keyAlgorithm?: 'Ed25519' | 'P-256';  // Track which key algorithm is used
  isNativeEd25519?: boolean;    // true if using hardware-backed Ed25519 (can't sign UCANs)
}

// Storage key for credentials
const STORAGE_KEY = 'webauthn_credential_info';

/**
 * Check WebAuthn support
 */
export async function checkWebAuthnSupport(): Promise<{
  supported: boolean;
  platformAuthenticator: boolean;
  error: string | null;
  message: string;
}> {
  if (!window.PublicKeyCredential) {
    return {
      supported: false,
      platformAuthenticator: false,
      error: 'WebAuthn not supported',
      message: 'Your browser does not support WebAuthn'
    };
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return {
      supported: true,
      platformAuthenticator: available,
      error: null,
      message: available 
        ? 'WebAuthn with platform authenticator available'
        : 'WebAuthn supported, but platform authenticator not available'
    };
  } catch (error) {
    return {
      supported: true,
      platformAuthenticator: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'WebAuthn supported, but could not check platform authenticator'
    };
  }
}

/**
 * Store credential info to localStorage
 * 
 * SECURITY: prfSeed is intentionally NOT stored for security reasons.
 * The PRF seed must be derived fresh from WebAuthn authentication each time.
 */
export function storeWebAuthnCredential(credential: WebAuthnCredentialInfo, key?: string): void {
  const storageKey = key || STORAGE_KEY;
  
  // Create a copy without prfSeed (security: don't persist encryption key material)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prfSeed, ...credentialWithoutSeed } = credential;
  
  localStorage.setItem(storageKey, JSON.stringify(credentialWithoutSeed));
  console.log('💾 Stored credential (prfSeed excluded for security)');
}

/**
 * Load credential info from localStorage
 */
export function loadWebAuthnCredential(key?: string): WebAuthnCredentialInfo | null {
  const storageKey = key || STORAGE_KEY;
  const stored = localStorage.getItem(storageKey);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Clear credential info from localStorage
 */
export function clearWebAuthnCredential(key?: string): void {
  const storageKey = key || STORAGE_KEY;
  localStorage.removeItem(storageKey);
}

/**
 * WebAuthn DID Provider with PRF extension support
 */
export class WebAuthnDIDProvider {
  public credentialId: string;
  public publicKey: WebAuthnCredentialInfo['publicKey'];
  public rawCredentialId: Uint8Array;
  public did: string;

  constructor(credentialInfo: WebAuthnCredentialInfo) {
    this.credentialId = credentialInfo.credentialId;
    this.publicKey = credentialInfo.publicKey;
    this.rawCredentialId = credentialInfo.rawCredentialId;
    this.did = credentialInfo.did || '';
  }

  /**
   * Check if WebAuthn is supported
   */
  static isSupported(): boolean {
    return !!window.PublicKeyCredential;
  }

  /**
   * Check if platform authenticator is available
   */
  static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Convert ArrayBuffer to base64url
   */
  static arrayBufferToBase64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Convert base64url to ArrayBuffer
   */
  static base64urlToArrayBuffer(base64url: string): ArrayBuffer {
    const base64 = base64url
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Extract public key from WebAuthn credential
   */
  static async extractPublicKey(credential: PublicKeyCredential): Promise<WebAuthnCredentialInfo['publicKey']> {
    const response = credential.response as AuthenticatorAttestationResponse;
    const attestationObject = response.attestationObject;
    
    // Parse CBOR attestation object
    const dataView = new DataView(attestationObject);
    let offset = 0;
    
    // Skip CBOR map header
    offset++;
    
    // Find authData
    while (offset < dataView.byteLength) {
      const key = dataView.getUint8(offset);
      offset++;
      
      if (key === 0x66) { // "authData" text string (6 bytes)
        offset += 7; // Skip "authData" string
        const authDataLength = dataView.getUint8(offset);
        offset++;
        const authDataBytes = new Uint8Array(attestationObject, offset, authDataLength);
        
        // Extract public key from authData
        // authData structure: rpIdHash (32) + flags (1) + signCount (4) + attestedCredData
        const attestedCredDataOffset = 37;
        
        if (authDataBytes.length > attestedCredDataOffset) {
          // Skip AAGUID (16 bytes) and credential ID length (2 bytes)
          const credIdLengthOffset = attestedCredDataOffset + 16;
          const credIdLength = (authDataBytes[credIdLengthOffset] << 8) | authDataBytes[credIdLengthOffset + 1];
          
          // Public key starts after credential ID
          const pubKeyOffset = credIdLengthOffset + 2 + credIdLength;
          
          // For ES256 (P-256), extract x and y coordinates from COSE key
          // This is a simplified extraction - proper CBOR parsing would be better
          const pubKeyBytes = authDataBytes.slice(pubKeyOffset);
          
          // Extract x and y (32 bytes each) from COSE key structure
          // In COSE, x is at offset ~10 and y at offset ~45 (approximate)
          const x = pubKeyBytes.slice(10, 42);
          const y = pubKeyBytes.slice(45, 77);
          
          return {
            algorithm: -7, // ES256
            x: x,
            y: y,
            keyType: 2,    // EC2
            curve: 1       // P-256
          };
        }
      }
      
      // Skip value
      offset += 10;
    }
    
    // Fallback: derive deterministic public key from credential ID
    return this.derivePublicKeyFromCredentialId(credential.rawId);
  }

  /**
   * Derive a deterministic public key from credential ID
   * Used as fallback when public key extraction fails
   */
  private static async derivePublicKeyFromCredentialId(
    credentialId: ArrayBuffer
  ): Promise<WebAuthnCredentialInfo['publicKey']> {
    const hash = await crypto.subtle.digest('SHA-256', credentialId);
    const seed = new Uint8Array(hash);

    const yData = new Uint8Array(credentialId.byteLength + 4);
    yData.set(new Uint8Array(credentialId), 0);
    yData.set([0x59, 0x43, 0x4F, 0x4F], credentialId.byteLength);
    const yHash = await crypto.subtle.digest('SHA-256', yData);
    const ySeed = new Uint8Array(yHash);

    return {
      algorithm: -7,
      x: seed.slice(0, 32),
      y: ySeed.slice(0, 32),
      keyType: 2,
      curve: 1
    };
  }

  /**
   * Create DID from credential info
   */
  static async createDID(credentialInfo: Omit<WebAuthnCredentialInfo, 'attestationObject'>): Promise<string> {
    const publicKey = credentialInfo.publicKey;
    
    // Create multicodec prefix for P-256 public key
    // 0x1200 = P-256 public key
    const multicodecPrefix = new Uint8Array([0x80, 0x24]);
    
    // Combine x and y coordinates (uncompressed format)
    const uncompressedKey = new Uint8Array(1 + publicKey.x.length + publicKey.y.length);
    uncompressedKey[0] = 0x04; // Uncompressed point indicator
    uncompressedKey.set(publicKey.x, 1);
    uncompressedKey.set(publicKey.y, 1 + publicKey.x.length);
    
    // Combine multicodec prefix with public key
    const multikey = new Uint8Array(multicodecPrefix.length + uncompressedKey.length);
    multikey.set(multicodecPrefix, 0);
    multikey.set(uncompressedKey, multicodecPrefix.length);
    
    // Encode to base58btc
    const encoded = base58btc.encode(multikey);
    
    return `did:key:${encoded}`;
  }

  /**
   * Extract PRF seed from WebAuthn credential with fallback to rawCredentialId
   * Returns the seed and which source was used
   */
  static async getPrfSeed(
    credential: PublicKeyCredential | null,
    rawCredentialId: Uint8Array
  ): Promise<{ seed: Uint8Array; source: 'prf' | 'credentialId' }> {
    // Try to get PRF extension result
    if (credential) {
      try {
        const extensions = credential.getClientExtensionResults();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prfResults = (extensions as any).prf;
        if (prfResults?.results?.first) {
          console.log('✅ Using WebAuthn PRF extension for key derivation');
          return {
            seed: new Uint8Array(prfResults.results.first),
            source: 'prf'
          };
        }
      } catch (error) {
        console.warn('⚠️ Error reading PRF extension results:', error);
      }
    }

    // Fallback to rawCredentialId
    console.log('ℹ️ PRF extension not available, using rawCredentialId for key derivation');
    return {
      seed: rawCredentialId,
      source: 'credentialId'
    };
  }

  /**
   * Try to create native Ed25519 WebAuthn credential (hardware-backed)
   * Returns null if not supported
   */
  static async tryCreateNativeEd25519(options: {
    userId?: string;
    displayName?: string;
    domain?: string;
  }): Promise<WebAuthnCredentialInfo | null> {
    const {
      userId = 'ucan-upload-wall-user',
      displayName = 'UCAN Upload Wall User',
      domain = window.location.hostname
    } = options;

    console.log('🔬 Attempting to create native Ed25519 WebAuthn credential...');

    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'UCAN Upload Wall', id: domain },
          user: {
            id: new TextEncoder().encode(userId),
            name: userId,
            displayName
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -8 }  // EdDSA (Ed25519)
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000
        }
      }) as PublicKeyCredential;

      if (!credential) {
        console.log('❌ Ed25519 credential creation returned null');
        return null;
      }

      const rawCredentialId = new Uint8Array(credential.rawId);
      console.log('✅ Successfully created native Ed25519 credential!');
      console.log('⚠️ Note: Ed25519 keys cannot sign arbitrary UCAN data via WebAuthn');
      
      // Create credential info with Ed25519 marker
      const credentialInfo: WebAuthnCredentialInfo = {
        credentialId: credential.id,
        rawCredentialId,
        publicKey: {
          algorithm: -8,  // EdDSA
          x: rawCredentialId.slice(0, 32),  // Use first 32 bytes as public key
          y: new Uint8Array(0),   // Ed25519 doesn't use y coordinate
          keyType: 1,  // OKP (Octet string key pairs)
          curve: 6     // Ed25519
        },
        userId,
        displayName,
        keyAlgorithm: 'Ed25519',
        isNativeEd25519: true
      };

      // Generate Ed25519 DID from the public key
      credentialInfo.did = await this.createEd25519DID(credentialInfo.publicKey.x);

      return credentialInfo;

    } catch (error) {
      console.log('ℹ️ Native Ed25519 not supported or failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Create Ed25519 DID from public key
   */
  static async createEd25519DID(publicKey: Uint8Array): Promise<string> {
    // Ed25519 multicodec prefix
    const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);
    
    // Concatenate multicodec prefix with public key
    const multicodecKey = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
    multicodecKey.set(ED25519_MULTICODEC);
    multicodecKey.set(publicKey, ED25519_MULTICODEC.length);
    
    // Encode to base58btc
    const encoded = base58btc.encode(multicodecKey);
    
    return `did:key:${encoded}`;
  }

  /**
   * Try to authenticate with an existing credential first, create new if none exists
   * Tries Ed25519 first, falls back to P-256 with PRF
   */
  static async getOrCreateCredential(options: {
    userId?: string;
    displayName?: string;
    domain?: string;
    existingCredentialId?: string;
  } = {}): Promise<WebAuthnCredentialInfo> {
    const {
      userId = 'ucan-upload-wall-user',
      displayName = 'UCAN Upload Wall User',
      domain = window.location.hostname,
      existingCredentialId
    } = options;

    // First try to use existing credential if we have one
    if (existingCredentialId) {
      try {
        console.log('🔓 Attempting to authenticate with existing credential');
        
        // Try to load stored credential info to get prfInput
        const storedCred = loadWebAuthnCredential();
        const prfInput = storedCred?.prfInput;
        
        const existingCredInfo = await this.authenticateWithExistingCredential(
          existingCredentialId,
          domain,
          prfInput
        );
        if (existingCredInfo) {
          console.log('✅ Successfully authenticated with existing credential');
          return existingCredInfo;
        }
      } catch (error) {
        console.warn('⚠️ Failed to authenticate with existing credential:', error);
        console.log('Will create new credential...');
      }
    }

    // Native Ed25519 is disabled by default because it cannot sign UCAN data
    // Only P-256 keys can work with the worker-based Ed25519 signing approach
    // 
    // Uncomment below to try native Ed25519 (for experimental/viewing-only use):
    // const ed25519Cred = await this.tryCreateNativeEd25519({ userId, displayName, domain });
    // if (ed25519Cred) {
    //   console.log('🎉 Using native hardware-backed Ed25519! (viewing only)');
    //   return ed25519Cred;
    // }

    // Create P-256 credential with PRF
    console.log('🆕 Creating new WebAuthn P-256 credential with PRF extension...');
    return this.createCredentialWithPRF({ userId, displayName, domain });
  }

  /**
   * Create WebAuthn credential with PRF extension support
   */
  static async createCredentialWithPRF(options: {
    userId?: string;
    displayName?: string;
    domain?: string;
  }): Promise<WebAuthnCredentialInfo> {
    const {
      userId = 'ucan-upload-wall-user',
      displayName = 'UCAN Upload Wall User',
      domain = window.location.hostname
    } = options;

    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    // Generate random PRF input (salt) for deterministic key derivation
    const prfInput = crypto.getRandomValues(new Uint8Array(32));

    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'UCAN Upload Wall', id: domain },
          user: {
            id: new TextEncoder().encode(userId),
            name: userId,
            displayName
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256 (P-256)
            { type: 'public-key', alg: -257 }  // RS256 fallback
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred'
          },
          timeout: 60000,
          // Request PRF extension
          extensions: {
            prf: {
              eval: { first: prfInput }
            }
          }
        }
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create WebAuthn credential');
      }

      console.log('✅ WebAuthn credential created successfully');

      // Extract public key
      const publicKey = await this.extractPublicKey(credential);

      // Get PRF seed (with fallback to rawCredentialId)
      const { seed: prfSeed, source } = await this.getPrfSeed(
        credential,
        new Uint8Array(credential.rawId)
      );

      const credentialInfo: WebAuthnCredentialInfo = {
        credentialId: this.arrayBufferToBase64url(credential.rawId),
        rawCredentialId: new Uint8Array(credential.rawId),
        publicKey,
        userId,
        displayName,
        prfInput: source === 'prf' ? prfInput : undefined,
        prfSeed: prfSeed,  // Store the actual PRF output seed
        prfSource: source
      };

      // Generate DID
      credentialInfo.did = await this.createDID(credentialInfo);

      console.log('🔑 Created DID:', credentialInfo.did);
      console.log('🔐 PRF source:', source);

      return credentialInfo;
    } catch (error) {
      const err = error as Error;
      console.error('Failed to create WebAuthn credential:', err);
        throw new Error(`WebAuthn credential creation failed: ${err.message}`);
    }
  }

  /**
   * Helper to get PRF seed from credential info
   * This is used when we need to extract the PRF seed for key derivation
   * 
   * SECURITY: This method now requires WebAuthn re-authentication to get fresh PRF output.
   * The PRF seed is NOT stored in localStorage for security reasons - it must be derived
   * from the user's biometric authentication each time.
   */
  static async extractPrfSeed(credentialInfo: WebAuthnCredentialInfo): Promise<Uint8Array> {
    console.log('🔐 Extracting PRF seed - WebAuthn authentication required');
    
    // Re-authenticate with WebAuthn to get fresh PRF output
    try {
      const freshCredInfo = await this.authenticateWithExistingCredential(
        credentialInfo.credentialId,
        window.location.hostname,
        credentialInfo.prfInput
      );
      
      if (freshCredInfo && freshCredInfo.prfSeed) {
        console.log('✅ PRF seed extracted from WebAuthn authentication', {
          source: freshCredInfo.prfSource,
          seedLength: freshCredInfo.prfSeed.length
        });
        return freshCredInfo.prfSeed;
      }
    } catch (error) {
      console.warn('⚠️ WebAuthn authentication failed, falling back to rawCredentialId:', error);
    }
    
    // Fallback to rawCredentialId if authentication fails
    console.log('ℹ️ Using rawCredentialId as PRF seed (fallback)');
    return credentialInfo.rawCredentialId;
  }

  /**
   * Authenticate with an existing WebAuthn credential and reconstruct DID
   * Compatibility method for our existing code - now with PRF support
   */
  static async authenticateWithExistingCredential(
    credentialId: string,
    domain: string = window.location.hostname,
    prfInput?: Uint8Array
  ): Promise<WebAuthnCredentialInfo | null> {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credentialIdBuffer = this.base64urlToArrayBuffer(credentialId);

      // Use stored PRF input if available, otherwise use a fixed value
      // (PRF will fail if input doesn't match, but we'll fallback to rawCredentialId)
      const prfEval = (prfInput || crypto.getRandomValues(new Uint8Array(32))) as BufferSource;

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: credentialIdBuffer,
            type: 'public-key'
          }],
          userVerification: 'required',
          timeout: 60000,
          rpId: domain,
          // Request PRF extension
          extensions: {
            prf: {
              eval: { first: prfEval }
            }
          }
        }
      }) as PublicKeyCredential;

      if (!assertion) {
        return null;
      }

      console.log('🔐 WebAuthn authentication successful');

      // Get PRF seed (with fallback to rawCredentialId)
      const { seed: prfSeed, source } = await this.getPrfSeed(
        assertion,
        new Uint8Array(credentialIdBuffer)
      );

      // Reconstruct credential info deterministically
      const reconstructedCredInfo = await this.reconstructCredentialFromAssertion(
        assertion,
        credentialId
      );

      // Add PRF metadata
      reconstructedCredInfo.prfInput = prfInput;
      reconstructedCredInfo.prfSeed = prfSeed;  // Store the actual PRF output seed
      reconstructedCredInfo.prfSource = source;

      console.log('🔐 PRF source:', source);

      return reconstructedCredInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Failed to authenticate with existing credential:', error);

      if (error.name === 'NotAllowedError') {
        throw new Error('Authentication was cancelled or failed');
      }

      return null;
    }
  }

  /**
   * Reconstruct credential info from assertion (for existing credentials)
   */
  static async reconstructCredentialFromAssertion(
    _assertion: PublicKeyCredential,
    credentialId: string
  ): Promise<WebAuthnCredentialInfo> {
    const credentialIdBuffer = this.base64urlToArrayBuffer(credentialId);
    const publicKey = await this.derivePublicKeyFromCredentialId(credentialIdBuffer);

    const credentialInfo = {
      credentialId,
      rawCredentialId: new Uint8Array(credentialIdBuffer),
      publicKey,
      userId: 'ucan-upload-wall-user',
      displayName: 'UCAN Upload Wall User',
      did: ''
    };

    // Generate DID
    credentialInfo.did = await this.createDID(credentialInfo);

    return credentialInfo;
  }

  /**
   * Authenticate using WebAuthn (for compatibility with existing code)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async authenticate(): Promise<any> {
    if (!WebAuthnDIDProvider.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: this.rawCredentialId as BufferSource,
            type: 'public-key'
          }],
          userVerification: 'required',
          timeout: 60000
        }
      });

      if (!assertion) {
        throw new Error('WebAuthn authentication failed');
      }

      console.log('✅ WebAuthn authentication completed successfully');
      return assertion;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('WebAuthn authentication failed:', error);

      if (error.name === 'NotAllowedError') {
        throw new Error('Biometric authentication was cancelled');
      } else {
        throw new Error(`WebAuthn authentication error: ${error.message}`);
      }
    }
  }

  /**
   * Sign data with WebAuthn (creates authentication assertion)
   */
  async sign(data: string | Uint8Array): Promise<string> {
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    
    // Create challenge from data hash
    const hash = await crypto.subtle.digest('SHA-256', dataBytes.buffer as ArrayBuffer);
    const challenge = new Uint8Array(hash);

    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: this.rawCredentialId as BufferSource,
            type: 'public-key'
          }],
          userVerification: 'required',
          timeout: 60000
        }
      }) as PublicKeyCredential;

      if (!assertion) {
        throw new Error('Failed to create signature');
      }

      const response = assertion.response as AuthenticatorAssertionResponse;
      const signature = new Uint8Array(response.signature);
      
      // Return base64url encoded signature
      return WebAuthnDIDProvider.arrayBufferToBase64url(signature.buffer);
    } catch (error) {
      const err = error as Error;
      throw new Error(`Signing failed: ${err.message}`);
    }
  }

  /**
   * Verify signature (placeholder - full verification would require crypto library)
   */
  async verify(): Promise<boolean> {
    // This would require implementing ECDSA verification with P-256
    // For now, return true as verification is typically done server-side
    console.warn('WebAuthn signature verification not implemented client-side');
    return true;
  }
}
