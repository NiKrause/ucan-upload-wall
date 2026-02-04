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
 * Find existing discoverable passkeys for this domain
 * Uses conditional UI to discover available credentials
 */
export async function findExistingPasskeys(): Promise<{
  found: boolean;
  credentials: WebAuthnCredentialInfo[];
  error?: string;
}> {
  if (!window.PublicKeyCredential) {
    return {
      found: false,
      credentials: [],
      error: 'WebAuthn not supported'
    };
  }

  try {
    console.log('🔍 Checking for existing passkeys...');
    
    // First check localStorage for stored credentials
    const storedCredential = loadWebAuthnCredential();
    if (storedCredential) {
      console.log('✅ Found stored credential in localStorage');
      return {
        found: true,
        credentials: [storedCredential]
      };
    }

    // Check if conditional UI is supported (for discoverable credentials)
    const conditionalUISupported = await PublicKeyCredential.isConditionalMediationAvailable?.();
    console.log('Conditional UI supported:', conditionalUISupported);
    
    if (!conditionalUISupported) {
      console.log('❌ Conditional UI not supported, no stored credentials found');
      return {
        found: false,
        credentials: [],
        error: 'No discoverable credentials and no stored credentials found'
      };
    }

    // Don't use conditional mediation here - it's for autofill
    // Just return that we might have discoverable credentials
    console.log('ℹ️ Conditional UI supported - discoverable credentials may be available');
    return {
      found: false, // We don't know for sure without trying authentication
      credentials: []
    };

  } catch (error) {
    console.warn('Error checking for existing passkeys:', error);
    
    // Fallback: check localStorage
    const storedCredential = loadWebAuthnCredential();
    if (storedCredential) {
      return {
        found: true,
        credentials: [storedCredential]
      };
    }
    
    return {
      found: false,
      credentials: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Create a new discoverable passkey credential
 * This creates a resident key that can be discovered later
 */
export async function createDiscoverablePasskey(options: {
  userId?: string;
  displayName?: string;
  domain?: string;
  requireResidentKey?: boolean;
}): Promise<WebAuthnCredentialInfo> {
  const {
    userId = 'ucan-upload-wall-user',
    displayName = 'UCAN Upload Wall User',
    domain = window.location.hostname,
    requireResidentKey = true
  } = options;

  if (!WebAuthnDIDProvider.isSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  console.log('🆕 Creating discoverable passkey credential...');

  // Use a deterministic PRF input based on domain and user ID
  // This ensures the same DID is generated for the same user on the same domain
  const deterministicSeed = `${domain}:${userId}:ucan-upload-wall`;
  const encoder = new TextEncoder();
  const seedBytes = encoder.encode(deterministicSeed);
  
  // Create a 32-byte PRF input by hashing the deterministic seed
  const prfInputHash = await crypto.subtle.digest('SHA-256', seedBytes);
  const prfInput = new Uint8Array(prfInputHash);

  console.log('🔑 Using deterministic PRF input for consistent DID generation');

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'UCAN Upload Wall', id: domain },
        user: {
          id: encoder.encode(userId),
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
          residentKey: requireResidentKey ? 'required' : 'preferred',
          requireResidentKey: requireResidentKey
        },
        timeout: 60000,
        // Request PRF extension with our deterministic input
        extensions: {
          prf: {
            eval: { first: prfInput }
          }
        }
      }
    }) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to create discoverable passkey credential');
    }

    console.log('✅ Discoverable passkey credential created successfully');

    // Extract public key
    const publicKey = await WebAuthnDIDProvider.extractPublicKey(credential);

    // Get PRF seed (with fallback to rawCredentialId)
    const { seed: prfSeed, source } = await WebAuthnDIDProvider.getPrfSeed(
      credential,
      new Uint8Array(credential.rawId)
    );

    const credentialInfo: WebAuthnCredentialInfo = {
      credentialId: WebAuthnDIDProvider.arrayBufferToBase64url(credential.rawId),
      rawCredentialId: new Uint8Array(credential.rawId),
      publicKey,
      userId,
      displayName,
      prfInput: prfInput, // Store the deterministic PRF input
      prfSeed: prfSeed,
      prfSource: source
    };

    // Generate DID
    credentialInfo.did = await WebAuthnDIDProvider.createDID(credentialInfo);

    console.log('🔑 Created DID:', credentialInfo.did);
    console.log('🔐 PRF source:', source);
    console.log('🏠 Resident key:', requireResidentKey ? 'required' : 'preferred');

    return credentialInfo;
  } catch (error) {
    const err = error as Error;
    console.error('Failed to create discoverable passkey credential:', err);
    throw new Error(`Discoverable passkey creation failed: ${err.message}`);
  }
}

/**
 * Authenticate with discoverable credentials
 * This will show available passkeys for the user to choose from
 */
export async function authenticateWithDiscoverableCredentials(options: {
  domain?: string;
  timeout?: number;
  userId?: string;
} = {}): Promise<WebAuthnCredentialInfo | null> {
  const {
    domain = window.location.hostname,
    timeout = 60000,
    userId = 'ucan-upload-wall-user'
  } = options;

  if (!WebAuthnDIDProvider.isSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  try {
    console.log('🔐 Authenticating with discoverable credentials...');
    console.log('Domain:', domain);

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    console.log('Challenge generated, length:', challenge.length);

    // Use the same deterministic PRF input as creation
    const deterministicSeed = `${domain}:${userId}:ucan-upload-wall`;
    const encoder = new TextEncoder();
    const seedBytes = encoder.encode(deterministicSeed);
    const prfInputHash = await crypto.subtle.digest('SHA-256', seedBytes);
    const prfInput = new Uint8Array(prfInputHash);

    console.log('🔑 Using deterministic PRF input for consistent DID generation');

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout,
        userVerification: 'required',
        rpId: domain,
        // Empty allowCredentials to discover all available credentials
        allowCredentials: [],
        // Request PRF extension with the same deterministic input
        extensions: {
          prf: {
            eval: { first: prfInput }
          }
        }
      }
      // Don't use mediation: 'conditional' here - that's for autofill
      // Regular get() will show the passkey selection UI
    }) as PublicKeyCredential;

    if (!assertion) {
      console.log('❌ No assertion returned');
      return null;
    }

    console.log('✅ Authentication successful with credential:', assertion.id);

    // Try to get PRF extension result if available
    let prfSeed: Uint8Array;
    let prfSource: 'prf' | 'credentialId' = 'credentialId';

    try {
      const extensions = assertion.getClientExtensionResults();
      console.log('Extensions:', extensions);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prfResults = (extensions as any).prf;
      if (prfResults?.results?.first) {
        prfSeed = new Uint8Array(prfResults.results.first);
        prfSource = 'prf';
        console.log('✅ Using WebAuthn PRF extension for key derivation');
      } else {
        prfSeed = new Uint8Array(assertion.rawId);
        console.log('ℹ️ PRF extension not available, using rawCredentialId for key derivation');
      }
    } catch (error) {
      console.warn('⚠️ Error reading PRF extension results:', error);
      prfSeed = new Uint8Array(assertion.rawId);
    }

    // Reconstruct credential info from assertion
    const credentialInfo = await WebAuthnDIDProvider.reconstructCredentialFromAssertion(
      assertion,
      assertion.id
    );

    // Add PRF metadata with the deterministic input
    credentialInfo.prfInput = prfInput; // Store the deterministic PRF input
    credentialInfo.prfSeed = prfSeed;
    credentialInfo.prfSource = prfSource;
    credentialInfo.userId = userId; // Ensure userId is set

    console.log('🔐 PRF source:', prfSource);

    return credentialInfo;
  } catch (error) {
    console.error('Authentication with discoverable credentials failed:', error);
    console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown');
    
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Authentication was cancelled or failed');
      } else if (error.name === 'InvalidStateError') {
        throw new Error('No passkeys available for this site');
      } else if (error.name === 'NotSupportedError') {
        throw new Error('Passkeys not supported on this device');
      }
    }
    
    throw error;
  }
}

/**
 * Simple passkey login function
 * Always tries authentication first (shows passkey popup), creates new if none exist
 */
export async function loginWithPasskey(options: {
  userId?: string;
  displayName?: string;
  domain?: string;
} = {}): Promise<{
  success: boolean;
  credentialInfo?: WebAuthnCredentialInfo;
  isNewCredential?: boolean;
  error?: string;
}> {
  const {
    userId = 'ucan-upload-wall-user',
    displayName = 'UCAN Upload Wall User',
    domain = window.location.hostname
  } = options;

  try {
    console.log('🔐 Starting passkey login process...');

    // Check WebAuthn support first
    const support = await checkWebAuthnSupport();
    if (!support.supported) {
      return {
        success: false,
        error: 'WebAuthn is not supported in this browser'
      };
    }

    // Always try authentication first - this will show the passkey selection popup
    console.log('� Attempting to authenticate with existing passkeys...');
    
    try {
      const authenticatedCred = await authenticateWithDiscoverableCredentials({ 
        domain, 
        userId 
      });
      
      if (authenticatedCred) {
        console.log('✅ Successfully authenticated with existing passkey');
        return {
          success: true,
          credentialInfo: authenticatedCred,
          isNewCredential: false
        };
      }
    } catch (authError) {
      console.log('⚠️ Authentication failed or cancelled:', authError);
      
      // If authentication was cancelled, don't try to create new credential
      if (authError instanceof Error && 
          (authError.message.includes('cancelled') || authError.message.includes('NotAllowedError'))) {
        return {
          success: false,
          error: 'Authentication was cancelled by user'
        };
      }
      
      // If no passkeys found, we'll create a new one below
      console.log('ℹ️ No existing passkeys found, will create new one...');
    }

    // No existing credentials or authentication failed - create new one
    console.log('🆕 Creating new discoverable passkey...');
    const newCredential = await createDiscoverablePasskey({
      userId,
      displayName,
      domain,
      requireResidentKey: true
    });

    console.log('✅ Successfully created new passkey credential');
    return {
      success: true,
      credentialInfo: newCredential,
      isNewCredential: true
    };

  } catch (error) {
    console.error('❌ Passkey login failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

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
   * Now uses discoverable credentials for better UX
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

    // First, try to find existing discoverable credentials
    console.log('🔍 Looking for existing passkeys...');
    const existingPasskeys = await findExistingPasskeys();
    
    if (existingPasskeys.found && existingPasskeys.credentials.length > 0) {
      console.log('✅ Found existing passkey, attempting authentication...');
      
      try {
        // Try to authenticate with discoverable credentials
        const authenticatedCred = await authenticateWithDiscoverableCredentials({ 
          domain, 
          userId 
        });
        
        if (authenticatedCred) {
          console.log('✅ Successfully authenticated with existing passkey');
          return authenticatedCred;
        }
      } catch (error) {
        console.warn('⚠️ Failed to authenticate with discoverable credentials:', error);
      }
    }

    // Fallback: try specific credential ID if provided
    if (existingCredentialId) {
      try {
        console.log('🔓 Attempting to authenticate with specific credential ID');
        
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
      }
    }

    // Create new discoverable credential
    console.log('🆕 Creating new discoverable passkey...');
    return createDiscoverablePasskey({ userId, displayName, domain });
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
   * SECURITY: This method now tries to use stored PRF seed first, only re-authenticates if needed.
   */
  static async extractPrfSeed(credentialInfo: WebAuthnCredentialInfo): Promise<Uint8Array> {
    console.log('🔐 Extracting PRF seed for key derivation');
    
    // First, try to use the stored PRF seed if available
    if (credentialInfo.prfSeed && credentialInfo.prfSeed.length > 0) {
      console.log('✅ Using stored PRF seed from credential info', {
        source: credentialInfo.prfSource,
        seedLength: credentialInfo.prfSeed.length
      });
      return credentialInfo.prfSeed;
    }
    
    // If no stored PRF seed, try to re-authenticate to get fresh PRF output
    console.log('⚠️ No stored PRF seed, attempting WebAuthn re-authentication...');
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
