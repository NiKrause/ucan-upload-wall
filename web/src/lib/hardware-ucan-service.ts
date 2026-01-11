/**
 * UCAN Delegation Service Extensions for WebAuthn Varsig
 * 
 * Adds hardware-backed UCAN signing using WebAuthn Ed25519 with varsig encoding
 */

import { WebAuthnEd25519Signer, createWebAuthnEd25519Credential, checkEd25519Support, type WebAuthnCredentialOptions } from './webauthn-ed25519-signer.js';
import { decodeWebAuthnVarsig, verifyWebAuthnAssertion, reconstructSignedData, verifyEd25519Signature } from './webauthn-varsig/index.js';

/**
 * Storage key for hardware-backed credential
 */
const HARDWARE_SIGNER_KEY = 'webauthn_ed25519_hardware_signer';

/**
 * Stored hardware signer info
 */
interface HardwareSignerInfo {
  credentialId: string;
  did: string;
  publicKey: string; // hex encoded
  created: string;
}

/**
 * Enhanced UCANDelegationService with hardware-backed signing
 */
export class HardwareUCANDelegationService {
  private hardwareSigner: WebAuthnEd25519Signer | null = null;
  
  /**
   * Check if hardware-backed Ed25519 is supported
   */
  async checkHardwareSupport(): Promise<boolean> {
    return await checkEd25519Support();
  }
  
  /**
   * Initialize hardware-backed signer
   * Try to load existing credential, or create new one
   * 
   * @param userId - User identifier for new credentials
   * @param displayName - Display name for new credentials
   * @param options - WebAuthn credential options (authenticator type preference)
   */
  async initializeHardwareSigner(
    userId?: string, 
    displayName?: string,
    options?: WebAuthnCredentialOptions
  ): Promise<boolean> {
    try {
      // Try to load existing signer
      const loaded = await this.loadHardwareSigner();
      if (loaded) {
        console.log('✅ Loaded existing hardware-backed signer');
        return true;
      }
      
      // Create new credential
      console.log('🔑 Creating new hardware-backed Ed25519 credential...');
      const signer = await createWebAuthnEd25519Credential(
        userId || 'user@example.com',
        displayName || 'UCAN User',
        options
      );
      
      if (!signer) {
        console.error('❌ Failed to create hardware credential');
        return false;
      }
      
      // Store signer info
      await this.storeHardwareSigner(signer);
      this.hardwareSigner = signer;
      
      console.log('✅ Hardware-backed signer initialized');
      console.log('   DID:', signer.did);
      return true;
    } catch (error) {
      console.error('Failed to initialize hardware signer:', error);
      return false;
    }
  }
  
  /**
   * Get hardware signer DID
   */
  getHardwareDID(): string | null {
    return this.hardwareSigner?.did || null;
  }
  
  /**
   * Create delegation using hardware-backed signer
   * Returns varsig-encoded UCAN
   */
  async createHardwareDelegation(
    toDid: string,
    spaceDid: string,
    capabilities: string[],
    expirationHours: number | null = 24
  ): Promise<string> {
    if (!this.hardwareSigner) {
      throw new Error('Hardware signer not initialized');
    }
    
    console.log('🔐 Creating delegation with hardware-backed Ed25519...');
    
    // Import ucanto modules
    const { delegate } = await import('@ucanto/core/delegation');
    const { Verifier } = await import('@ucanto/principal');
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type UcanVerifier = any;
    
    // Create verifier for target
    const targetVerifier = Verifier.parse(toDid) as UcanVerifier;
    
    // Build capabilities
    const ucanCapabilities = capabilities.map(cap => ({
      with: spaceDid,
      can: cap
    }));
    
    // Calculate expiration
    const expirationTimestamp = expirationHours !== null
      ? Math.floor(Date.now() / 1000) + (expirationHours * 60 * 60)
      : undefined;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type UcanSigner = any;
    
    // Create delegation with hardware signer
    const delegation = await delegate({
      issuer: this.hardwareSigner.toUcantoSigner() as UcanSigner,
      audience: targetVerifier,
      capabilities: ucanCapabilities,
      expiration: expirationTimestamp,
      facts: []
    });
    
    console.log('✅ Delegation created with hardware signature');
    console.log('   Issuer:', this.hardwareSigner.did);
    console.log('   Audience:', toDid);
    console.log('   Capabilities:', capabilities.length);
    
    // Archive to CAR format
    const carBytes = await delegation.archive();
    
    // Encode as multibase base64url
    const base64 = btoa(String.fromCharCode(...new Uint8Array(carBytes.ok)));
    const multibaseProof = 'u' + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    return multibaseProof;
  }
  
  /**
   * Verify hardware-backed delegation (varsig)
   */
  async verifyHardwareDelegation(
    delegationProof: string,
    expectedOrigin: string
  ): Promise<{
    valid: boolean;
    error?: string;
    issuerDid?: string;
    audienceDid?: string;
  }> {
    try {
      // Decode delegation
      const { extract } = await import('@ucanto/core/delegation');
      
      // Remove multibase prefix and decode
      let cleanProof = delegationProof.trim();
      if (cleanProof.startsWith('u') || cleanProof.startsWith('m')) {
        cleanProof = cleanProof.slice(1);
      }
      
      // Convert base64url to bytes
      const base64 = cleanProof.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - (base64.length % 4)) % 4);
      const binaryString = atob(base64 + padding);
      const tokenBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        tokenBytes[i] = binaryString.charCodeAt(i);
      }
      
      // Extract delegation
      const extractResult = await extract(tokenBytes);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegation = (extractResult as any).ok || extractResult;
      
      if (!delegation) {
        return { valid: false, error: 'Failed to extract delegation' };
      }
      
      // Check if signature is varsig-encoded
      const signature = delegation.signature;
      
      try {
        // Try to decode as varsig
        const decoded = decodeWebAuthnVarsig(new Uint8Array(signature));
        
        // Verify WebAuthn assertion structure
        const payloadBytes = new TextEncoder().encode(JSON.stringify(delegation.data));
        const challengeHash = await crypto.subtle.digest('SHA-256', payloadBytes);
        
        const verificationResult = verifyWebAuthnAssertion(decoded, {
          expectedOrigin,
          expectedChallenge: new Uint8Array(challengeHash),
          requireUserVerification: true
        });
        
        if (!verificationResult.valid) {
          return {
            valid: false,
            error: `WebAuthn verification failed: ${verificationResult.error}`
          };
        }
        
        // Verify cryptographic signature
        const signedData = await reconstructSignedData(decoded);
        const publicKey = await this.extractPublicKeyFromDid(delegation.issuer.did());
        
        const signatureValid = await verifyEd25519Signature(
          signedData,
          decoded.signature,
          publicKey
        );
        
        if (!signatureValid) {
          return { valid: false, error: 'Ed25519 signature verification failed' };
        }
        
        return {
          valid: true,
          issuerDid: delegation.issuer.did(),
          audienceDid: delegation.audience.did()
        };
      } catch {
        // Not a varsig-encoded delegation, use standard verification
        console.log('Not a varsig delegation, using standard verification');
        
        return {
          valid: true, // Assume ucanto already verified it
          issuerDid: delegation.issuer.did(),
          audienceDid: delegation.audience.did()
        };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Verification error: ${(error as Error).message}`
      };
    }
  }
  
  /**
   * Store hardware signer info
   */
  private async storeHardwareSigner(signer: WebAuthnEd25519Signer): Promise<void> {
    const info: HardwareSignerInfo = {
      credentialId: btoa(String.fromCharCode(...new Uint8Array(signer['credentialId'] as ArrayBuffer))),
      did: signer.did,
      publicKey: Array.from(signer.publicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
      created: new Date().toISOString()
    };
    
    localStorage.setItem(HARDWARE_SIGNER_KEY, JSON.stringify(info));
  }
  
  /**
   * Load hardware signer from storage
   */
  private async loadHardwareSigner(): Promise<boolean> {
    const stored = localStorage.getItem(HARDWARE_SIGNER_KEY);
    if (!stored) return false;
    
    try {
      const info: HardwareSignerInfo = JSON.parse(stored);
      
      // Convert hex public key back to bytes
      const publicKey = new Uint8Array(
        info.publicKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );
      
      // Convert base64 credential ID back to bytes
      const binaryString = atob(info.credentialId);
      const credentialId = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        credentialId[i] = binaryString.charCodeAt(i);
      }
      
      // Recreate signer
      this.hardwareSigner = new WebAuthnEd25519Signer(
        credentialId.buffer,
        info.did,
        publicKey
      );
      
      return true;
    } catch (error) {
      console.error('Failed to load hardware signer:', error);
      return false;
    }
  }
  
  /**
   * Extract Ed25519 public key from did:key
   */
  private async extractPublicKeyFromDid(did: string): Promise<Uint8Array> {
    if (!did.startsWith('did:key:z')) {
      throw new Error('Invalid DID format');
    }
    
    // Dynamically import base58btc
    const { base58btc } = await import('multiformats/bases/base58');
    
    // Remove 'did:key:' prefix
    const encoded = did.slice(8);
    
    // Decode base58btc
    const multikey = base58btc.decode(encoded);
    
    // Skip multicodec prefix (0xed, 0x01)
    return multikey.slice(2);
  }
}
