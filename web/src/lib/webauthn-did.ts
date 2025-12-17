/**
 * WebAuthn DID Provider
 * 
 * Re-exports from @le-space/orbitdb-identity-provider-webauthn-did
 * Using the battle-tested OrbitDB implementation for better reliability
 */

import {
  WebAuthnDIDProvider as OrbitDBWebAuthnDIDProvider,
  checkWebAuthnSupport,
  storeWebAuthnCredential,
  loadWebAuthnCredential,
  clearWebAuthnCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';

// Re-export unchanged functions
export { 
  checkWebAuthnSupport,
  storeWebAuthnCredential,
  loadWebAuthnCredential,
  clearWebAuthnCredential
};

// TypeScript type definitions (OrbitDB is JavaScript)
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
}

/**
 * Extended WebAuthn DID Provider with compatibility methods
 * Wraps OrbitDB's provider and adds methods needed by our code
 */
export class WebAuthnDIDProvider extends OrbitDBWebAuthnDIDProvider {
  public did: string;

  constructor(credentialInfo: WebAuthnCredentialInfo) {
    super(credentialInfo);
    this.did = credentialInfo.did || '';
  }

  /**
   * Try to authenticate with an existing credential first, create new if none exists
   * Compatibility method for our existing code
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
        const existingCredInfo = await this.authenticateWithExistingCredential(existingCredentialId, domain);
        if (existingCredInfo) {
          console.log('✅ Successfully authenticated with existing credential');
          return existingCredInfo;
        }
      } catch (error) {
        console.warn('⚠️ Failed to authenticate with existing credential:', error);
        console.log('Will create new credential...');
      }
    }

    // Fallback to creating new credential
    console.log('🆕 Creating new WebAuthn credential...');
    return this.createCredential({ userId, displayName, domain });
  }

  /**
   * Authenticate with an existing WebAuthn credential and reconstruct DID
   * Compatibility method for our existing code
   */
  static async authenticateWithExistingCredential(
    credentialId: string,
    domain: string = window.location.hostname
  ): Promise<WebAuthnCredentialInfo | null> {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credentialIdBuffer = this.base64urlToArrayBuffer(credentialId);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: credentialIdBuffer,
            type: 'public-key'
          }],
          userVerification: 'required',
          timeout: 60000,
          rpId: domain
        }
      });

      if (!assertion) {
        return null;
      }

      console.log('🔐 WebAuthn authentication successful');

      // Reconstruct credential info deterministically
      const reconstructedCredInfo = await this.reconstructCredentialFromAssertion(
        assertion as PublicKeyCredential,
        credentialId
      );

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
    const hash = await crypto.subtle.digest('SHA-256', credentialIdBuffer);
    const seed = new Uint8Array(hash);

    const yData = new Uint8Array(credentialIdBuffer.byteLength + 4);
    yData.set(new Uint8Array(credentialIdBuffer), 0);
    yData.set([0x59, 0x43, 0x4F, 0x4F], credentialIdBuffer.byteLength);
    const yHash = await crypto.subtle.digest('SHA-256', yData);
    const ySeed = new Uint8Array(yHash);

    const publicKey = {
      algorithm: -7,
      x: seed.slice(0, 32),
      y: ySeed.slice(0, 32),
      keyType: 2,
      curve: 1
    };

    const credentialInfo = {
      credentialId,
      rawCredentialId: new Uint8Array(credentialIdBuffer),
      publicKey,
      userId: 'ucan-upload-wall-user',
      displayName: 'UCAN Upload Wall User',
      did: ''
    };

    // Generate DID using OrbitDB's method
    credentialInfo.did = await this.createDID(credentialInfo);

    return credentialInfo;
  }

  /**
   * Authenticate using WebAuthn (for compatibility with existing code)
   */
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
}
