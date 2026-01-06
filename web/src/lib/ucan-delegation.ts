/**
 * UCAN Delegation Service
 * 
 * Handles delegation creation, storage, and management for Storacha integration
 * Uses P-256 keys from WebAuthn DID for delegation signatures
 */

import * as Client from '@storacha/client';
import * as Proof from '@storacha/client/proof';
import { StoreMemory } from '@storacha/client/stores/memory';
import * as Ed25519Principal from '@ucanto/principal/ed25519';
import type { Signer as UcanSigner, DID as UcanDID } from '@ucanto/interface';
import { WebAuthnDIDProvider, WebAuthnCredentialInfo, storeWebAuthnCredential } from './webauthn-did';
import {
  initEd25519KeystoreWithPrfSeed,
  generateWorkerEd25519DID,
  encryptArchive,
  decryptArchive
} from './secure-ed25519-did';

// Storage keys for localStorage
const STORAGE_KEYS = {
  WEBAUTHN_CREDENTIAL: 'webauthn_credential_info',
  ED25519_KEYPAIR: 'ed25519_keypair',
  ED25519_ARCHIVE_ENCRYPTED: 'ed25519_archive_encrypted',
  ENCRYPTED_KEYSTORE_CREDENTIAL_ID: 'encrypted_keystore_credential_id',
  STORACHA_KEY: 'storacha_key',
  STORACHA_PROOF: 'storacha_proof',
  SPACE_DID: 'space_did',
  CREATED_DELEGATIONS: 'created_delegations',
  RECEIVED_DELEGATIONS: 'received_delegations',
  REVOCATION_CACHE: 'revocation_cache'  // Cache for revocation status checks
} as const;

interface Ed25519KeyPair {
  publicKey: string; // hex encoded
  privateKey: string; // hex encoded  
  did: string;
}

export interface StorachaCredentials {
  key: string;
  proof: string;
  spaceDid: string;
}

export interface DelegationInfo {
  id: string;
  name?: string;          // User-friendly name for the delegation (e.g. "Alice's Upload Token")
  fromIssuer: string;     // Who created the delegation
  toAudience: string;     // Who the delegation is for
  proof: string;
  capabilities: string[];
  createdAt: string;
  expiresAt?: string;     // When the delegation expires (ISO string)
  format?: string;        // Format of the imported delegation (e.g. "multibase-base64", "multibase-base64url", "storacha-cli")
  revoked?: boolean;      // Whether this delegation has been revoked
  revokedAt?: string;     // When it was revoked (ISO string)
  revokedBy?: string;     // DID of who revoked it
}

export class UCANDelegationService {
  private webauthnProvider: WebAuthnDIDProvider | null = null;
  private ed25519Keypair: Ed25519KeyPair | null = null;
  private storachaClient: Client.Client | null = null;
  private ed25519Archive: { id: string; keys: Record<string, Uint8Array> } | null = null;

  /**
   * Initialize or load existing Ed25519 DID
   * Always tries to load existing first unless force=true
   */
  async initializeEd25519DID(force = false): Promise<Ed25519KeyPair> {
    // If we already have BOTH keypair AND archive (and not forcing), return it
    if (this.ed25519Keypair && this.ed25519Archive && !force) {
      console.log('Using cached Ed25519 keypair and archive');
      return this.ed25519Keypair;
    }

    // Try to load existing keypair from localStorage first (unless force=true)
    const storedKeypair = localStorage.getItem(STORAGE_KEYS.ED25519_KEYPAIR);
    
    if (storedKeypair && !force) {
      try {
        console.log('Found stored Ed25519 keypair, restoring...');
        const keypair: Ed25519KeyPair = JSON.parse(storedKeypair);
        this.ed25519Keypair = keypair;
        
        // Restore encrypted archive from localStorage and decrypt via worker
        const storedEncrypted = localStorage.getItem(STORAGE_KEYS.ED25519_ARCHIVE_ENCRYPTED);
        if (storedEncrypted) {
          // Ensure worker is initialized (needed for decryption)
          await this.initializeWebAuthnDID(false);
          const storedCredential = localStorage.getItem(STORAGE_KEYS.WEBAUTHN_CREDENTIAL);
          if (storedCredential) {
            const credentialInfo: WebAuthnCredentialInfo = JSON.parse(storedCredential);
            
            // Restore Uint8Array fields from stored data
            if (!(credentialInfo.rawCredentialId instanceof Uint8Array)) {
              credentialInfo.rawCredentialId = new Uint8Array(Object.values(credentialInfo.rawCredentialId));
            }
            // Note: prfInput might exist, but prfSeed is never stored (security)
            if (credentialInfo.prfInput && !(credentialInfo.prfInput instanceof Uint8Array)) {
              credentialInfo.prfInput = new Uint8Array(Object.values(credentialInfo.prfInput));
            }
            
            // SECURITY: extractPrfSeed will now require WebAuthn re-authentication
            const prfSeed = await WebAuthnDIDProvider.extractPrfSeed(credentialInfo);
            await initEd25519KeystoreWithPrfSeed(prfSeed);
            
            // Decrypt archive
            const encryptedArchive = JSON.parse(storedEncrypted);
            const ciphertext = new Uint8Array(
              encryptedArchive.ciphertext.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
            );
            const iv = new Uint8Array(
              encryptedArchive.iv.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
            );
            this.ed25519Archive = await decryptArchive(ciphertext, iv);
            console.log('✅ Successfully decrypted and restored Ed25519 archive');
          } else {
            console.warn('WebAuthn credential missing, cannot decrypt archive');
            throw new Error('WebAuthn credential required to decrypt archive');
          }
        } else {
          console.warn('Encrypted archive not found in localStorage');
          throw new Error('Ed25519 archive missing');
        }
        
        console.log('✅ Successfully restored Ed25519 DID:', keypair.did);
        return keypair;
      } catch (error) {
        console.warn('Failed to restore stored Ed25519 keypair, creating new one', error);
        localStorage.removeItem(STORAGE_KEYS.ED25519_KEYPAIR);
        localStorage.removeItem(STORAGE_KEYS.ED25519_ARCHIVE_ENCRYPTED);
      }
    }

    // Generate new Ed25519 keypair inside the web worker, seeded from WebAuthn
    console.log('Generating new Ed25519 keypair via worker + WebAuthn PRF seed...');

    // Ensure we have a WebAuthn credential (this may trigger a WebAuthn flow)
    await this.initializeWebAuthnDID(false);

    const storedCredential = localStorage.getItem(STORAGE_KEYS.WEBAUTHN_CREDENTIAL);
    if (!storedCredential) {
      throw new Error('WebAuthn credential is required to derive PRF seed for Ed25519 keystore');
    }

    let prfSeed: Uint8Array;
    try {
      const credentialInfo: WebAuthnCredentialInfo = JSON.parse(storedCredential);
      
      // Restore Uint8Array fields from stored data
      if (!(credentialInfo.rawCredentialId instanceof Uint8Array)) {
        credentialInfo.rawCredentialId = new Uint8Array(Object.values(credentialInfo.rawCredentialId));
      }
      // Note: prfInput might exist, but prfSeed is never stored (security)
      if (credentialInfo.prfInput && !(credentialInfo.prfInput instanceof Uint8Array)) {
        credentialInfo.prfInput = new Uint8Array(Object.values(credentialInfo.prfInput));
      }
      
      // SECURITY: extractPrfSeed will now require WebAuthn re-authentication
      prfSeed = await WebAuthnDIDProvider.extractPrfSeed(credentialInfo);
      
      console.log('Deriving worker keystore from WebAuthn PRF', {
        prfSeedLength: prfSeed.length,
        prfSource: credentialInfo.prfSource || 'credentialId (legacy)'
      });
    } catch (error) {
      console.error('Failed to parse stored WebAuthn credential for PRF seed', error);
      throw new Error('Invalid stored WebAuthn credential; cannot derive PRF seed');
    }

    await initEd25519KeystoreWithPrfSeed(prfSeed);

    const { publicKey, did, archive } = await generateWorkerEd25519DID();
    console.log('Generated worker-based Ed25519 DID from WebAuthn PRF-derived keystore:', did);

    const keypair: Ed25519KeyPair = {
      publicKey: Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join(''),
      // Private key is encoded in the Ed25519 archive; we don't store it here.
      privateKey: '',
      did
    };
    
    // Store keypair in localStorage
    localStorage.setItem(STORAGE_KEYS.ED25519_KEYPAIR, JSON.stringify(keypair));
    
    // Encrypt archive using worker's AES key and store it
    const { ciphertext, iv } = await encryptArchive(archive);
    const encryptedArchive = {
      ciphertext: Array.from(ciphertext).map(b => b.toString(16).padStart(2, '0')).join(''),
      iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('')
    };
    localStorage.setItem(STORAGE_KEYS.ED25519_ARCHIVE_ENCRYPTED, JSON.stringify(encryptedArchive));
    
    this.ed25519Keypair = keypair;
    this.ed25519Archive = archive;
    console.log('✅ Created and stored new Ed25519 DID with encrypted archive:', did);
    
    return keypair;
  }

  /**
   * Initialize or load existing WebAuthn DID (deprecated - use Ed25519 instead)
   * Always tries to load existing first unless force=true
   */
  async initializeWebAuthnDID(force = false): Promise<WebAuthnDIDProvider> {
    // If we already have a provider and not forcing, return it
    if (this.webauthnProvider && !force) {
      console.log('Using cached WebAuthn provider');
      return this.webauthnProvider;
    }

    // ALWAYS try to load existing credential from localStorage first (unless force=true)
    const storedCredential = localStorage.getItem(STORAGE_KEYS.WEBAUTHN_CREDENTIAL);
    
    if (storedCredential && !force) {
      try {
        console.log('Found stored WebAuthn credential, attempting to restore...');
        const credentialInfo: WebAuthnCredentialInfo = JSON.parse(storedCredential);
        
        // Restore Uint8Array from stored data (they get serialized as objects)
        credentialInfo.rawCredentialId = new Uint8Array(Object.values(credentialInfo.rawCredentialId));
        credentialInfo.publicKey.x = new Uint8Array(Object.values(credentialInfo.publicKey.x));
        credentialInfo.publicKey.y = new Uint8Array(Object.values(credentialInfo.publicKey.y));
        
        // Restore PRF-related Uint8Array fields if present
        // Note: prfInput is stored (safe), but prfSeed is never stored (security)
        if (credentialInfo.prfInput && !(credentialInfo.prfInput instanceof Uint8Array)) {
          credentialInfo.prfInput = new Uint8Array(Object.values(credentialInfo.prfInput));
        }

        this.webauthnProvider = new WebAuthnDIDProvider(credentialInfo);
        console.log('✅ Successfully restored WebAuthn DID');
        return this.webauthnProvider;
        
      } catch {
        console.warn('Failed to restore stored WebAuthn credential, creating new one');
        // Clear invalid stored credential
        localStorage.removeItem(STORAGE_KEYS.WEBAUTHN_CREDENTIAL);
      }
    }

    // Create new credential only if no valid stored one exists or force=true
    let existingCredentialId = null;
    
    if (storedCredential && !force) {
      try {
        const storedInfo = JSON.parse(storedCredential);
        existingCredentialId = storedInfo?.credentialId;
      } catch {
        console.warn('Failed to extract credential ID from stored data');
      }
    }
    
    const credentialInfo = await WebAuthnDIDProvider.getOrCreateCredential({
      displayName: 'UCAN Upload Wall User',
      userId: 'ucan-upload-wall-user',
      existingCredentialId: force ? null : existingCredentialId // Don't use existing if forcing new
    });

    // Store credential info in localStorage (prfSeed excluded for security)
    storeWebAuthnCredential(credentialInfo, STORAGE_KEYS.WEBAUTHN_CREDENTIAL);

    this.webauthnProvider = new WebAuthnDIDProvider(credentialInfo);
    console.log('✅ Created and stored new WebAuthn DID');
    
    return this.webauthnProvider;
  }

  /**
   * Get current DID (prioritizes Ed25519 > WebAuthn)
   */
  getCurrentDID(): string | null {
    // Lazily load from localStorage if not in memory
    if (!this.ed25519Keypair) {
      const storedKeypair = localStorage.getItem(STORAGE_KEYS.ED25519_KEYPAIR);
      if (storedKeypair) {
        try {
          this.ed25519Keypair = JSON.parse(storedKeypair);
        } catch (e) {
          console.error('Failed to parse stored ed25519Keypair:', e);
        }
      }
    }
    return this.ed25519Keypair?.did || this.webauthnProvider?.did || null;
  }

  /**
   * Parse a delegation proof string using the appropriate method
   * Tries ucanto extract first, then Storacha Proof.parse as fallback
   * @param proofString The delegation proof (multibase encoded)
   * @returns Parsed delegation object
   */
  private async parseDelegationProof(proofString: string): Promise<unknown> {
    // Normalize the proof: add 'm' prefix if not present
    let normalizedProof = proofString.trim();
    if (!normalizedProof.startsWith('m') && !normalizedProof.startsWith('u')) {
      normalizedProof = 'm' + normalizedProof;
    }
    
    // Decode the multibase string to bytes
    let tokenBytes: Uint8Array;
    if (normalizedProof.startsWith('m')) {
      // Standard base64
      const base64Part = normalizedProof.substring(1);
      const binary = atob(base64Part);
      tokenBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        tokenBytes[i] = binary.charCodeAt(i);
      }
    } else if (normalizedProof.startsWith('u')) {
      // Base64url
      const base64urlPart = normalizedProof.substring(1);
      const standardBase64 = this.base64urlToBase64(base64urlPart);
      const binary = atob(standardBase64);
      tokenBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        tokenBytes[i] = binary.charCodeAt(i);
      }
    } else {
      throw new Error('Invalid multibase prefix');
    }
    
    // Try ucanto extract first (for delegations created by this app)
    try {
      const { extract } = await import('@ucanto/core/delegation');
      const extractResult = await extract(tokenBytes);
      
      if (extractResult && extractResult.ok) {
        return extractResult.ok;
      } else if (extractResult && !extractResult.error) {
        return extractResult;
      }
      throw new Error('ucanto extract failed');
    } catch (ucantoError) {
      console.log('ucanto extract failed, trying Storacha Proof.parse:', (ucantoError as Error).message);
    }
    
    // Fallback to Storacha Proof.parse (for Storacha CLI delegations)
    try {
      const Proof = await import('@storacha/client/proof');
      const delegation = await Proof.parse(normalizedProof);
      return delegation;
    } catch (proofError) {
      console.error('Storacha Proof.parse also failed:', (proofError as Error).message);
      throw new Error(`Failed to parse delegation: ucanto and Storacha methods both failed. Error: ${(proofError as Error).message}`);
    }
  }

  /**
   * Get a UCAN Signer backed by the worker keystore.
   * Reconstructs Ed25519Signer from encrypted archive stored in localStorage.
   */
  /**
   * Check if using native Ed25519 (which cannot sign UCANs)
   */
  private isNativeEd25519(): boolean {
    const credInfo = localStorage.getItem('webauthn_credential_info');
    if (credInfo) {
      try {
        const parsed = JSON.parse(credInfo);
        return parsed.isNativeEd25519 === true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private async getWorkerPrincipal(): Promise<UcanSigner<UcanDID<'key'>>> {
    // Check if using native Ed25519 (incompatible with worker-based signing)
    if (this.isNativeEd25519()) {
      throw new Error(
        'Native Ed25519 WebAuthn keys cannot sign UCAN data. ' +
        'Please use P-256 keys or worker-based Ed25519 to create/use delegations.'
      );
    }

    if (!this.ed25519Keypair || !this.ed25519Archive) {
      await this.initializeEd25519DID();
    }

    if (!this.ed25519Archive) {
      throw new Error('Ed25519 archive not available. Cannot create principal.');
    }

    // Reconstruct a full Ed25519Signer from the archive produced in the worker.
    // This gives Storacha a principal with the exact shape it expects, including
    // sign(), verify(), encode(), toArchive(), etc.
    // Type cast needed because archive.id is string but Ed25519Principal.from expects DID type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const principal = Ed25519Principal.from(this.ed25519Archive as any) as UcanSigner<UcanDID<'key'>>;
    return principal;
  }

  /**
   * Store Storacha credentials
   */
  storeStorachaCredentials(credentials: StorachaCredentials): void {
    localStorage.setItem(STORAGE_KEYS.STORACHA_KEY, credentials.key);
    localStorage.setItem(STORAGE_KEYS.STORACHA_PROOF, credentials.proof);
    localStorage.setItem(STORAGE_KEYS.SPACE_DID, credentials.spaceDid);
    console.log('✅ Stored Storacha credentials');
  }

  /**
   * Get stored Storacha credentials
   */
  getStorachaCredentials(): StorachaCredentials | null {
    const key = localStorage.getItem(STORAGE_KEYS.STORACHA_KEY);
    const proof = localStorage.getItem(STORAGE_KEYS.STORACHA_PROOF);
    const spaceDid = localStorage.getItem(STORAGE_KEYS.SPACE_DID);

    if (!key || !proof || !spaceDid) {
      return null;
    }

    return { key, proof, spaceDid };
  }

  /**
   * Initialize Storacha client with stored credentials
   */
  async initializeStorachaClient(): Promise<Client.Client> {
    const credentials = this.getStorachaCredentials();
    if (!credentials) {
      throw new Error('No Storacha credentials found. Please add your KEY and Proof first.');
    }

    if (!this.webauthnProvider) {
      await this.initializeWebAuthnDID();
    }

    try {
      // For now, we'll create a simple principal using the stored key
      // In a full implementation, this would use the WebAuthn DID for signing
      const { Signer } = await import('@storacha/client/principal/ed25519');
      const principal = Signer.parse(credentials.key);
      
      const store = new StoreMemory();
      const client = await Client.create({ principal, store });

      const proof = await Proof.parse(credentials.proof);
      const space = await client.addSpace(proof);
      await client.setCurrentSpace(space.did());

      this.storachaClient = client;
      console.log('✅ Initialized Storacha client with space:', space.did());
      
      return client;
    } catch (error) {
      console.error('Failed to initialize Storacha client:', error);
      throw new Error('Failed to initialize Storacha client. Please check your credentials.');
    }
  }

  /**
   * Delete an upload from Storacha space
   */
  async deleteUpload(rootCid: string): Promise<void> {
    const credentials = this.getStorachaCredentials();
    const receivedDelegations = this.getReceivedDelegations();
    
    // Check if we have delete capability
    const hasDeleteCapability = credentials || receivedDelegations.some(delegation => 
      delegation.capabilities.some(cap => 
        cap === 'upload/remove' || cap === 'upload/*' ||
        cap === 'space/*' || cap === 'store/remove' || cap === 'store/*'
      )
    );
    
    if (!hasDeleteCapability) {
      throw new Error('No delete permissions available. Need upload/remove or store/remove capability.');
    }
    
    try {
      if (credentials) {
        return await this.deleteWithCredentials(rootCid);
      } else {
        const delegation = receivedDelegations.find(d => 
          d.capabilities.some(cap => 
            cap === 'upload/remove' || cap === 'upload/*' ||
            cap === 'space/*' || cap === 'store/remove' || cap === 'store/*'
          )
        );
        if (delegation) {
          return await this.deleteWithDelegation(rootCid, delegation);
        }
      }
    } catch (error) {
      console.error('Delete failed:', error);
      throw new Error(`Failed to delete upload: ${error}`);
    }
  }
  
  private async deleteWithCredentials(rootCid: string): Promise<void> {
    if (!this.storachaClient) {
      await this.initializeStorachaClient();
    }
    
    if (!this.storachaClient) {
      throw new Error('Storacha client not initialized');
    }
    
    const { parse } = await import('multiformats/link');
    const cid = parse(rootCid);
    
    // Use the client's remove method which handles upload/remove
    await this.storachaClient.remove(cid);
    console.log('✅ Deleted upload:', rootCid);
  }
  
  private async deleteWithDelegation(rootCid: string, delegationInfo: DelegationInfo): Promise<void> {
    try {
      // Validate delegation before use
      const validation = await this.validateDelegation(delegationInfo);
      if (!validation.valid) {
        throw new Error(`Cannot delete: ${validation.reason}`);
      }
      
      // Parse the delegation using the helper method (tries ucanto first, then Storacha)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegation = await this.parseDelegationProof(delegationInfo.proof) as any;
      
      const Client = await import('@storacha/client');
      const { StoreMemory } = await import('@storacha/client/stores/memory');

      // Use worker-backed Ed25519 principal (WebAuthn PRF → keystore)
      const principal = await this.getWorkerPrincipal();

      console.log('📋 Principal DID:', principal.did());
      console.log('📋 Delegation audience (should match):', delegationInfo.toAudience);
      
      // CRITICAL: Verify the delegation is for this principal
      if (principal.did() !== delegationInfo.toAudience) {
        const errorMsg = `❌ DID Mismatch!\n\nThe delegation is for: ${delegationInfo.toAudience}\nBut your current DID is: ${principal.did()}\n\nPlease delete the stored keys and reimport the delegation.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('✅ DID matches - delegation is for this principal');

      const store = new StoreMemory();
      const client = await Client.create({
        principal,
        store
      });
      
      if (delegation.capabilities && delegation.capabilities.length > 0) {
        const cap = delegation.capabilities[0];
        if (cap.with && typeof cap.with === 'string' && cap.with.startsWith('did:key:')) {
          try {
            const space = await client.addSpace(delegation);
            await client.setCurrentSpace(space.did());
            console.log('✅ Space set successfully for delete operation');
          } catch (spaceError) {
            console.error('❌ Failed to set current space:', (spaceError as Error).message);
            throw spaceError;
          }
        }
      }
      
      const { parse } = await import('multiformats/link');
      const cid = parse(rootCid);
      
      await client.remove(cid);
      console.log('✅ Deleted upload via delegation:', rootCid);
    } catch (error) {
      console.error('Delete with delegation failed:', error);
      throw error;
    }
  }
  
  /**
   * Check if user has delete capability
   */
  hasDeleteCapability(): boolean {
    const credentials = this.getStorachaCredentials();
    const receivedDelegations = this.getReceivedDelegations();
    
    return !!credentials || receivedDelegations.some(delegation => 
      delegation.capabilities.some(cap => 
        cap === 'upload/remove' || cap === 'upload/*' ||
        cap === 'space/*' || cap === 'store/remove' || cap === 'store/*'
      )
    );
  }
  
  /**
   * Upload file to Storacha
   * Browser A: Uses stored Storacha credentials directly
   * Browser B: Uses delegations received from Browser A
   */
  async uploadFile(file: File): Promise<{ cid: string }> {
    console.log('\ud83d\udcc2 uploadFile() called for:', file.name);
    
    const credentials = this.getStorachaCredentials();
    const receivedDelegations = this.getReceivedDelegations();
    
    console.log('Has credentials:', !!credentials);
    console.log('Received delegations count:', receivedDelegations.length);
    
    if (receivedDelegations.length > 0) {
      console.log('Delegations found:');
      receivedDelegations.forEach((d, i) => {
        console.log(`  Delegation ${i + 1}:`);
        console.log('    ID:', d.id);
        console.log('    Name:', d.name);
        console.log('    Capabilities:', JSON.stringify(d.capabilities, null, 2));
        console.log('    From:', d.fromIssuer);
        console.log('    To:', d.toAudience);
      });
    }
    
    // Check if we have Storacha credentials (Browser A scenario)
    if (credentials) {
      console.log('\u2705 Using Storacha credentials');
      return this.uploadWithStorachaCredentials(file);
    }
    
    // Check if we have received delegations with upload capability (Browser B scenario)
    // Support both exact matches and wildcard capabilities (e.g., 'upload/*' includes 'upload/add')
    const uploadDelegation = receivedDelegations.find(delegation => 
      delegation.capabilities.some(cap => 
        cap === 'upload/add' || cap === 'upload/*' ||
        cap === 'space/blob/add' || cap === 'space/*' || cap === 'blob/*' ||
        cap === 'store/add' || cap === 'store/*'
      )
    );
    
    if (uploadDelegation) {
      console.log('\u2705 Found upload delegation:', uploadDelegation.name || uploadDelegation.id);
      return this.uploadWithDelegation(file, uploadDelegation);
    }
    
    console.error('\u274c No upload permissions found!');
    console.error('Available delegations:', receivedDelegations);
    throw new Error('No upload permissions available. Need credentials or delegation with upload/add capability.');
  }
  
  /**
   * Upload file using Storacha credentials (Browser A)
   */
  private async uploadWithStorachaCredentials(file: File): Promise<{ cid: string }> {
    if (!this.storachaClient) {
      await this.initializeStorachaClient();
    }

    if (!this.storachaClient) {
      throw new Error('Storacha client not initialized');
    }

    try {
      // Convert File to Blob
      const blob = new Blob([await file.arrayBuffer()]);
      const cid = await this.storachaClient.uploadFile(blob);
      
      console.log('✅ File uploaded via Storacha credentials:', cid.toString());
      return { cid: cid.toString() };
    } catch (error) {
      console.error('Upload with Storacha credentials failed:', error);
      throw new Error(`Upload failed: ${error}`);
    }
  }
  
  /**
   * List uploads from Storacha space using credentials or delegation
   */
  async listUploads(): Promise<Array<{ root: string; shards?: string[]; insertedAt?: string; updatedAt?: string }>> {
    const credentials = this.getStorachaCredentials();
    const receivedDelegations = this.getReceivedDelegations();
    
    try {
      // Check if we have Storacha credentials (Browser A scenario)
      if (credentials) {
        console.log('Listing uploads using Storacha credentials...');
        return await this.listUploadsWithCredentials();
      }
      
      // Check if we have received delegations with upload/list capability (Browser B scenario)
      const uploadDelegation = receivedDelegations.find(delegation => 
        delegation.capabilities.some(cap => 
          cap === 'upload/list' || cap === 'upload/*' ||
          cap === 'space/info' || cap === 'space/*'
        )
      );
      
      if (uploadDelegation) {
        console.log('Listing uploads using delegation...');
        return await this.listUploadsWithDelegation(uploadDelegation);
      }
      
      console.warn('No credentials or delegations with list capability found');
      return [];
    } catch (error) {
      console.error('Failed to list uploads:', error);
      return [];
    }
  }
  
  /**
   * List uploads using Storacha credentials (Browser A)
   */
  private async listUploadsWithCredentials(): Promise<Array<{ root: string; shards?: string[]; insertedAt?: string; updatedAt?: string }>> {
    if (!this.storachaClient) {
      await this.initializeStorachaClient();
    }

    if (!this.storachaClient) {
      throw new Error('Storacha client not initialized');
    }

    try {
      // Use the correct Storacha API: client.capability.upload.list()
      const result = await this.storachaClient.capability.upload.list();
      
      const uploads = [];
      // Result is directly {size, results, before}, not wrapped in .ok
      if (result.results && Array.isArray(result.results)) {
        for (const item of result.results) {
          uploads.push({
            root: item.root.toString(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            shards: item.shards?.map((s: any) => s.toString()),
            insertedAt: item.insertedAt,
            updatedAt: item.updatedAt
          });
        }
      }
      
      console.log(`\u2705 Found ${uploads.length} uploads`);
      return uploads;
    } catch (error) {
      console.error('List uploads with credentials failed:', error);
      return [];
    }
  }
  
  /**
   * List uploads using delegation (Browser B)
   */
  private async listUploadsWithDelegation(delegationInfo: DelegationInfo): Promise<Array<{ root: string; shards?: string[]; insertedAt?: string; updatedAt?: string }>> {
    try {
      // Validate delegation before use
      const validation = await this.validateDelegation(delegationInfo);
      if (!validation.valid) {
        console.warn(`Cannot list uploads: ${validation.reason}`);
        return []; // Return empty list instead of throwing
      }
      
      // Parse the delegation using the helper method (tries ucanto first, then Storacha)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegation = await this.parseDelegationProof(delegationInfo.proof) as any;
      
      // Import required modules
      const Client = await import('@storacha/client');
      const { StoreMemory } = await import('@storacha/client/stores/memory');

      // Use worker-backed Ed25519 principal (WebAuthn PRF → keystore)
      const principal = await this.getWorkerPrincipal();

      console.log('📋 Principal DID:', principal.did());
      console.log('📋 Delegation audience (should match):', delegationInfo.toAudience);
      
      // CRITICAL: Verify the delegation is for this principal
      if (principal.did() !== delegationInfo.toAudience) {
        const errorMsg = `❌ DID Mismatch!\n\nThe delegation is for: ${delegationInfo.toAudience}\nBut your current DID is: ${principal.did()}\n\nThis happened because:\n1. Your WebAuthn PRF changed (fell back to rawCredentialId)\n2. This generated a different encryption key\n3. The decrypted archive contains a different Ed25519 keypair\n\nSolution:\n- Delete the stored archive and regenerate your Ed25519 DID\n- Or request a new delegation for your current DID`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('✅ DID matches - delegation is for this principal');

      // Create Storacha client with the Ed25519 principal
      const store = new StoreMemory();
      const client = await Client.create({
        principal,
        store
      });
      
      // Get space DID from delegation and set as current
      if (delegation.capabilities && delegation.capabilities.length > 0) {
        const cap = delegation.capabilities[0];
        if (cap.with && typeof cap.with === 'string' && cap.with.startsWith('did:key:')) {
          try {
            const space = await client.addSpace(delegation);
            await client.setCurrentSpace(space.did());
            console.log('✅ Space set successfully:', space.did());
          } catch (spaceError) {
            console.error('❌ Failed to set current space:', (spaceError as Error).message);
            throw spaceError; // Don't continue if space setup fails
          }
        }
      }
      
      // Try multiple methods to list uploads
      const uploads = [];
      
      try {
        console.log('Attempting client.capability.upload.list()...');
        const uploadResult = await client.capability.upload.list();
        console.log('Upload list result:', uploadResult);
        
        // Result is directly {size, results, before}, not wrapped in .ok
        if (uploadResult.results && Array.isArray(uploadResult.results)) {
          console.log(`Found ${uploadResult.results.length} uploads`);
          for (const item of uploadResult.results) {
            console.log('Upload item:', item);
            uploads.push({
              root: item.root.toString(),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            shards: item.shards?.map((s: any) => s.toString()),
              insertedAt: item.insertedAt,
              updatedAt: item.updatedAt
            });
          }
        }
      } catch (listError) {
        console.error('Failed to list uploads:', listError);
      }
      
      console.log(`\u2705 Found ${uploads.length} uploads via delegation`);
      return uploads;
    } catch (error) {
      console.error('List uploads with delegation failed:', error);
      throw error;
    }
  }
  
  /**
   * Upload file using delegations (Browser B)
   */
  private async uploadWithDelegation(file: File, delegationInfo: DelegationInfo): Promise<{ cid: string }> {
    try {
      console.log('Using delegation for upload:', delegationInfo.id);
      
      // Validate delegation before use
      const validation = await this.validateDelegation(delegationInfo);
      if (!validation.valid) {
        throw new Error(`Cannot upload: ${validation.reason}`);
      }
      
      // Parse the delegation using the helper method (tries ucanto first, then Storacha)
      console.log('Parsing delegation proof...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegation = await this.parseDelegationProof(delegationInfo.proof) as any;
      console.log('✅ Delegation parsed for upload');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log('Delegation capabilities:', delegation.capabilities.map((c: any) => c.can).join(', '));
      
      // Import required modules
      const Client = await import('@storacha/client');
      const { StoreMemory } = await import('@storacha/client/stores/memory');

      // Use worker-backed Ed25519 principal (WebAuthn PRF → keystore)
      const principal = await this.getWorkerPrincipal();

      console.log('Using principal DID:', principal.did());
      console.log('Delegation audience (should match):', delegationInfo.toAudience);
      
      // Verify the delegation is for this principal
      if (principal.did() !== delegationInfo.toAudience) {
        console.error('\u274c DID Mismatch!');
        console.error('  Expected (delegation audience):', delegationInfo.toAudience);
        console.error('  Got (current principal):', principal.did());
        
        throw new Error(
          `Delegation DID mismatch!\n\n` +
          `The delegation is for: ${delegationInfo.toAudience}\n` +
          `But you are using: ${principal.did()}\n\n` +
          `Solution:\n` +
          `1. On the Storacha CLI, create a NEW delegation for: ${principal.did()}\n` +
          `2. Import that new delegation here\n\n` +
          `Or, delete the stored Ed25519 key in localStorage and try again with the old delegation.`
        );
      }
      
      // Create Storacha client with the Ed25519 principal
      const store = new StoreMemory();
      const client = await Client.create({
        principal,
        store,
      });
      
      console.log('✅ Created Storacha client with delegation');
      
      // Get space DID from delegation capabilities
      let spaceDid = 'unknown';
      if (delegation.capabilities && delegation.capabilities.length > 0) {
        const cap = delegation.capabilities[0];
        if (cap.with && typeof cap.with === 'string' && cap.with.startsWith('did:key:')) {
          spaceDid = cap.with;
          console.log('Space DID from delegation:', spaceDid);
          
          // Add space using the delegation and set as current
          try {
            const space = await client.addSpace(delegation);
            await client.setCurrentSpace(space.did());
            console.log('✅ Space set successfully');
          } catch (spaceError) {
            console.warn('Failed to set current space:', (spaceError as Error).message);
          }
        }
      }
      
      // Upload file using the Storacha client's high-level API
      console.log('Uploading file...');
      const blob = new Blob([await file.arrayBuffer()]);
      const cid = await client.uploadFile(blob);
      
      console.log('✅ File uploaded successfully:', cid.toString());
      return { cid: cid.toString() };
    } catch (error) {
      console.error('Upload with delegation failed:', error);
      throw new Error(`Delegated upload failed: ${error}`);
    }
  }

  /**
   * Create a UCAN delegation to another DID
   * Supports two modes:
   * 1. Direct delegation from Storacha credentials (if available)
   * 2. Delegation chaining from a received UCAN delegation (if no credentials)
   * @param toDid Target DID to delegate to
   * @param capabilities Array of capability strings to delegate
   * @param expirationHours Number of hours until delegation expires (default: 24, null = no expiration)
   */
  async createDelegation(toDid: string, capabilities: string[] = ['space/blob/add', 'space/blob/list', 'space/blob/remove', 'store/add', 'store/list', 'store/remove', 'upload/add', 'upload/list', 'upload/remove'], expirationHours: number | null = 24): Promise<string> {
    if (!this.webauthnProvider) {
      throw new Error('WebAuthn provider not initialized');
    }

    const credentials = this.getStorachaCredentials();
    const receivedDelegations = this.getReceivedDelegations();
    
    // Determine delegation source: credentials (preferred) or received delegation (chaining)
    let spaceDid: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let issuer: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let proofDelegation: any = null;
    
    if (credentials) {
      // Mode 1: Direct delegation from Storacha credentials
      console.log('Creating delegation from Storacha credentials');
      
      if (!this.storachaClient) {
        await this.initializeStorachaClient();
      }
      
      const { Signer: EdDSASigner } = await import('@storacha/client/principal/ed25519');
      issuer = EdDSASigner.parse(credentials.key);
      spaceDid = credentials.spaceDid;
    } else if (receivedDelegations.length > 0) {
      // Mode 2: Delegation chaining from received delegation
      console.log('Creating delegation via chaining from received UCAN delegation');
      
      // Find a suitable delegation that has the capabilities we need
      const suitableDelegation = receivedDelegations.find(d => 
        d.capabilities.some(cap => 
          capabilities.some(reqCap => 
            cap === reqCap || cap === reqCap.split('/')[0] + '/*' || cap === '*'
          )
        )
      );
      
      if (!suitableDelegation) {
        throw new Error('No suitable received delegation found with required capabilities. Need a delegation that includes at least one of the requested capabilities.');
      }
      
      // Parse the received delegation to use as proof (using helper for compatibility)
      proofDelegation = await this.parseDelegationProof(suitableDelegation.proof);
      
      // Extract space DID from the delegation's capabilities
      if (proofDelegation.capabilities && proofDelegation.capabilities.length > 0) {
        const cap = proofDelegation.capabilities[0];
        if (cap.with && typeof cap.with === 'string' && cap.with.startsWith('did:key:')) {
          spaceDid = cap.with;
          console.log('Extracted space DID from received delegation:', spaceDid);
        } else {
          throw new Error('Received delegation does not contain a valid space DID in capabilities');
        }
      } else {
        throw new Error('Received delegation has no capabilities');
      }
      
      // Use worker principal (Ed25519) as issuer for chained delegation
      issuer = await this.getWorkerPrincipal();
      console.log('Using worker Ed25519 principal as issuer for chained delegation:', issuer.did());
    } else {
      throw new Error('No Storacha credentials or received delegations found. Cannot create delegation without either credentials or a delegation to chain from.');
    }

    try {
      // Authenticate with WebAuthn to prove identity
      await this.webauthnProvider.authenticate();
      
      // Import ucanto delegation and principal modules
      const { delegate } = await import('@ucanto/core/delegation');
      const { Verifier } = await import('@ucanto/principal');
      
      // Create verifier for the target DID
      const targetVerifier = Verifier.parse(toDid as UcanDID);
      
      // Convert capability strings to proper UCAN capability objects
      const ucanCapabilities = capabilities
        .filter(cap => cap && typeof cap === 'string')
        .map(cap => ({
          with: spaceDid,
          can: cap
        }));
      
      // Calculate expiration timestamp (undefined if no expiration)
      const expirationTimestamp = expirationHours !== null 
        ? Math.floor(Date.now() / 1000) + (expirationHours * 60 * 60)
        : undefined;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegationParams: any = {
        issuer,
        audience: targetVerifier,
        capabilities: ucanCapabilities,
        expiration: expirationTimestamp,
        facts: []
      };
      
      // Add proof if chaining from received delegation
      if (proofDelegation) {
        delegationParams.proofs = [proofDelegation];
        console.log('Including received delegation as proof in delegation chain');
      }
      
      // Validate delegation parameters
      if (!delegationParams.issuer || !delegationParams.audience) {
        throw new Error('Delegation parameters missing issuer or audience');
      }
      
      const delegation = await delegate(delegationParams);
      
      console.log('✅ Delegation created successfully');
      
      // Archive to CAR format using ucanto's archive method directly
      console.log('📦 Archiving delegation to CAR format...');
      const archiveResult = await delegation.archive();
      
      let carBytes: Uint8Array;
      if (archiveResult && typeof archiveResult === 'object' && 'ok' in archiveResult) {
        carBytes = archiveResult.ok as Uint8Array;
      } else if (archiveResult instanceof Uint8Array) {
        carBytes = archiveResult;
      } else {
        throw new Error('Unexpected archive result format');
      }
      
      if (!carBytes || carBytes.length === 0) {
        throw new Error('Delegation archive resulted in empty bytes');
      }
      
      // Convert to base64 and add multibase 'm' prefix (matching Storacha CLI format)
      // Create a new ArrayBuffer to ensure correct type
      const buffer = new Uint8Array(carBytes).buffer;
      const carBase64 = 'm' + this.arrayBufferToBase64(buffer);
      
      console.log('✅ Delegation archived to CAR format, length:', carBase64.length);
      console.log('📋 First 50 chars:', carBase64.substring(0, 50));
      
      // Store delegation info for UI
      const delegationInfo: DelegationInfo = {
        id: delegation.cid.toString(),
        fromIssuer: typeof issuer.did === 'function' ? issuer.did() : issuer.did,
        toAudience: toDid,
        proof: carBase64,
        capabilities,
        createdAt: new Date().toISOString(),
        expiresAt: expirationTimestamp ? new Date(expirationTimestamp * 1000).toISOString() : undefined
      };
      
      this.storeDelegation(delegationInfo);
      
      console.log('✅ Delegation created and stored successfully');
      return carBase64;
      
    } catch (error) {
      console.error('Failed to create UCAN delegation:', error);
      throw new Error(`Failed to create delegation: ${error}`);
    }
  }

  /**
   * Store a delegation we created
   */
  private storeDelegation(delegation: DelegationInfo): void {
    const stored = localStorage.getItem(STORAGE_KEYS.CREATED_DELEGATIONS);
    const delegations: DelegationInfo[] = stored ? JSON.parse(stored) : [];
    delegations.unshift(delegation);
    localStorage.setItem(STORAGE_KEYS.CREATED_DELEGATIONS, JSON.stringify(delegations));
  }

  /**
   * Get all delegations we've created
   */
  getCreatedDelegations(): DelegationInfo[] {
    const stored = localStorage.getItem(STORAGE_KEYS.CREATED_DELEGATIONS);
    return stored ? JSON.parse(stored) : [];
  }


  /**
   * Import a UCAN delegation from another browser/DID
   * @param delegationProof The delegation proof string (multibase encoded)
   * @param name Optional user-friendly name for this delegation
   */
  async importDelegation(delegationProof: string, name?: string): Promise<void> {
    try {
      // Ensure we have a DID before verifying audience
      if (!this.webauthnProvider) {
        console.log('🔑 Initializing WebAuthn DID before import...');
        await this.initializeWebAuthnDID();
      }
      if (!this.getCurrentDID()) {
        console.log('🔐 Authenticating to finalize DID before import...');
        await this.webauthnProvider!.authenticate();
      }

      console.log('Importing delegation...');
      
      // Clean the input: remove whitespace, line breaks, etc.
      const cleanedProof = delegationProof.trim().replace(/\s+/g, '').replace(/[\r\n]/g, '');
      console.log('Original length:', delegationProof.length, 'Cleaned length:', cleanedProof.length);
      console.log('First chars:', cleanedProof.substring(0, 20));
      
      let delegationInfo: DelegationInfo;
      let detectedFormat = 'unknown';
      
      // Track errors from different parsing attempts
      let ucantoError: Error | null = null;
      let storachaProofError: Error | null = null;
      
      // Check if it's multibase encoded (starts with 'm' for base64 multibase)
      let tokenBytes: Uint8Array;
      if (cleanedProof.startsWith('m')) {
        console.log('Detected multibase encoding (base64), decoding...');
        detectedFormat = 'multibase-base64 (Storacha CLI format)';
        try {
          // 'm' prefix indicates standard base64 encoding in multibase
          // Remove 'm' prefix and decode as standard base64
          const base64Part = cleanedProof.substring(1);
          console.log('Base64 part length:', base64Part.length);
          console.log('Base64 part (first 50 chars):', base64Part.substring(0, 50));
          const binary = atob(base64Part);
          tokenBytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            tokenBytes[i] = binary.charCodeAt(i);
          }
          console.log('Multibase decoded successfully, bytes length:', tokenBytes.length);
          console.log('First 32 bytes (hex):', Array.from(tokenBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
          console.log('First 32 bytes (decimal):', Array.from(tokenBytes.slice(0, 32)).join(', '));
        } catch (multibaseError) {
          console.error('Multibase decoding failed:', multibaseError);
          throw multibaseError;
        }
      } else if (cleanedProof.startsWith('u')) {
        console.log('Detected multibase encoding (base64url), decoding...');
        detectedFormat = 'multibase-base64url';
        try {
          // 'u' prefix indicates base64url encoding in multibase
          // Remove 'u' prefix and decode as base64url
          const base64urlPart = cleanedProof.substring(1);
          const standardBase64 = this.base64urlToBase64(base64urlPart);
          const binary = atob(standardBase64);
          tokenBytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            tokenBytes[i] = binary.charCodeAt(i);
          }
          console.log('Multibase decoded successfully, bytes length:', tokenBytes.length);
        } catch (multibaseError) {
          console.error('Multibase decoding failed:', multibaseError);
          throw multibaseError;
        }
      } else {
        // Try as raw text first
        detectedFormat = 'raw-text';
        tokenBytes = new TextEncoder().encode(cleanedProof);
      }
      
      // PRIORITY 1: Try ucanto's extract() first (for delegations created by this app)
      try {
        console.log('Attempting to parse with @ucanto/core/delegation extract() (primary method)...');
        
        const { extract } = await import('@ucanto/core/delegation');
        
        // Extract from the bytes we decoded earlier
        const extractResult = await extract(tokenBytes);
        
        // Handle ucanto Result format
        let delegation;
        if (extractResult && extractResult.ok) {
          delegation = extractResult.ok;
        } else if (extractResult && !extractResult.error) {
          delegation = extractResult;
        } else {
          console.log('Extract failed, trying Storacha Proof.parse()...');
          throw new Error('Extraction returned error');
        }
        
        console.log('✅ Successfully parsed delegation with ucanto extract()');
        
        // Verify the delegation is for our DID
        const ourDid = this.getCurrentDID();
        const audienceDid = typeof delegation.audience.did === 'function' 
          ? delegation.audience.did() 
          : delegation.audience;
        const issuerDid = typeof delegation.issuer.did === 'function'
          ? delegation.issuer.did()
          : delegation.issuer;
        const issuerDidString = typeof issuerDid === 'string' ? issuerDid : issuerDid.did();
        
        console.log('Delegation audience:', audienceDid);
        console.log('Our DID:', ourDid);
        
        if (audienceDid !== ourDid) {
          throw new Error(`This delegation is not for your current DID.\n\nExpected: ${ourDid}\nGot: ${audienceDid}\n\nPlease create a delegation for the correct DID.`);
        }
        
        // Extract capabilities from the delegation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capabilities = delegation.capabilities.map((cap: any) => cap.can || cap.capability || cap);
        
        // Generate default name if not provided
        const defaultName = name || `Delegation from ${issuerDidString.slice(0, 20)}... (${new Date().toLocaleDateString()})`;
        
        delegationInfo = {
          id: delegation.cid?.toString() || crypto.randomUUID(),
          name: defaultName,
          fromIssuer: String(issuerDid),
          toAudience: audienceDid,
          proof: cleanedProof,
          capabilities,
          createdAt: new Date().toISOString(),
          expiresAt: delegation.expiration ? new Date(delegation.expiration * 1000).toISOString() : undefined,
          format: detectedFormat + ' (ucanto extract)'
        };
        
        console.log('\u2705 Delegation parsed successfully with ucanto');
        console.log('  From:', issuerDid);
        console.log('  To:', audienceDid);
        console.log('  Capabilities:', capabilities.join(', '));
        console.log('  Format:', delegationInfo.format);
        
        // Store the delegation
        this.storeReceivedDelegation(delegationInfo);
        console.log('\u2705 Delegation imported and stored successfully');
        return; // Success! Exit the function
        
      } catch (err) {
        ucantoError = err as Error;
        console.log('ucanto extract() failed:', ucantoError.message);
        console.log('Trying @storacha/client/proof as fallback...');
      }
      
      // PRIORITY 2: Try @storacha/client/proof (for Storacha CLI delegations)
      try {
        console.log('Attempting to parse with @storacha/client/proof...');
        
        const Proof = await import('@storacha/client/proof');
        
        // Parse the delegation using Storacha's proof parser
        // It accepts the original multibase string
        const delegation = await Proof.parse(cleanedProof);
        
        console.log('✅ Successfully parsed delegation with @storacha/client/proof');
        
        // Verify the delegation is for our DID
        const ourDid = this.getCurrentDID();
        const audienceDid = delegation.audience.did();
        const issuerDid = delegation.issuer.did();
        
        console.log('Delegation audience:', audienceDid);
        console.log('Our DID:', ourDid);
        
        if (audienceDid !== ourDid) {
          throw new Error(`This delegation is not for your current DID.\n\nExpected: ${ourDid}\nGot: ${audienceDid}\n\nPlease create a delegation for the correct DID.`);
        }
        
        // Extract capabilities from the delegation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capabilities = delegation.capabilities.map((cap: any) => cap.can);
        
        // Generate default name if not provided
        const defaultName = name || `Delegation from ${issuerDid.slice(0, 20)}... (${new Date().toLocaleDateString()})`;
        
        delegationInfo = {
          id: delegation.root.cid.toString(),
          name: defaultName,
          fromIssuer: issuerDid,
          toAudience: audienceDid,
          proof: cleanedProof,
          capabilities,
          createdAt: new Date().toISOString(),
          expiresAt: undefined, // Storacha CLI delegations don't include expiration in the parsed object
          format: detectedFormat + ' (Storacha CLI)'
        };
        
        console.log('\u2705 Delegation parsed successfully with Storacha proof');
        console.log('  From:', issuerDid);
        console.log('  To:', audienceDid);
        console.log('  Capabilities:', capabilities.join(', '));
        console.log('  Format:', delegationInfo.format);
        
        // Store the delegation
        this.storeReceivedDelegation(delegationInfo);
        console.log('\u2705 Delegation imported and stored successfully');
        return; // Success! Exit the function
      } catch (err) {
        storachaProofError = err as Error;
        console.log('Storacha Proof.parse() failed:', storachaProofError.message);
        console.log('Trying legacy formats as last resort...');
        
        try {
          // Try to decode base64 first
          const decodedArrayBuffer = this.base64ToArrayBuffer(delegationProof);
        
        // Try to parse as JSON (for our fallback format or ucanto result format)
        try {
          const uint8Array = new Uint8Array(decodedArrayBuffer);
          const decodedText = new TextDecoder().decode(uint8Array);
          
          const jsonDelegation = JSON.parse(decodedText);
          
          // Check if it's a ucanto result format with 'ok' property
          if (jsonDelegation && jsonDelegation.ok && typeof jsonDelegation.ok === 'object') {
            const okData = jsonDelegation.ok;
            
            // Convert object with numeric keys to Uint8Array
            if (typeof okData === 'object' && !Array.isArray(okData)) {
              const keys = Object.keys(okData).map(k => parseInt(k)).filter(k => !isNaN(k)).sort((a, b) => a - b);
              if (keys.length > 0) {
                const maxKey = Math.max(...keys);
                const carBytes = new Uint8Array(maxKey + 1);
                for (const key of keys) {
                  carBytes[parseInt(key as unknown as string)] = okData[key as keyof typeof okData];
                }
                
                // Now try to parse this as CAR format directly
                try {
                  const { extract } = await import('@ucanto/core/delegation');
                  
                  const extractResult = await extract(carBytes);
                  
                  // Handle ucanto Result format - check if it's {ok: Delegation} or {error: Error}
                  let delegation;
                  if (extractResult && extractResult.ok) {
                    delegation = extractResult.ok;
                  } else if (extractResult && !extractResult.error) {
                    delegation = extractResult;
                  } else {
                    console.error('Extraction failed:', extractResult?.error);
                    throw new Error('Failed to extract delegation from CAR data');
                  }
                  
                  if (delegation && delegation.audience) {
                    
                    const ourDid = this.getCurrentDID();
                    const audienceDid = typeof delegation.audience.did === 'function' 
                      ? delegation.audience.did() 
                      : delegation.audience;
                    const issuerDid = typeof delegation.issuer.did === 'function'
                      ? delegation.issuer.did()
                      : delegation.issuer;
                    
                    if (audienceDid !== ourDid) {
                      throw new Error(`This delegation is not for your current DID. Expected: ${ourDid}, Got: ${audienceDid}`);
                    }
                    
                    delegationInfo = {
                      id: delegation.cid?.toString() || crypto.randomUUID(),
                      fromIssuer: String(issuerDid),
                      toAudience: audienceDid,
                      proof: delegationProof,
                      capabilities: Array.isArray(delegation.capabilities) 
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ? delegation.capabilities.map((cap: any) => cap.can || cap.capability || cap)
                        : ['space/blob/add', 'space/blob/list', 'space/blob/remove', 'store/add', 'store/list', 'store/remove', 'upload/add', 'upload/list', 'upload/remove'],
                      createdAt: new Date().toISOString(),
                      expiresAt: delegation.expiration ? new Date(delegation.expiration * 1000).toISOString() : undefined,
                      format: 'ucanto-result-format (base64-encoded JSON)'
                    };
                    
                    // Successfully parsed, we're done
                  } else {
                    throw new Error('Invalid delegation extracted from ucanto format');
                  }
                } catch (extractError) {
                  console.warn('Failed to extract from ucanto ok data:', (extractError as Error).message);
                  throw new Error('Failed to extract from ucanto format');
                }
              } else {
                throw new Error('Invalid ucanto ok format - no numeric keys');
              }
            } else {
              throw new Error('Unexpected ucanto ok format');
            }
          }
          // Check if it's our fallback format
          else if (jsonDelegation.issuer && jsonDelegation.audience && jsonDelegation.capabilities) {
            // Verify this delegation is for our DID
            const ourDid = this.getCurrentDID();
            if (jsonDelegation.audience !== ourDid) {
              throw new Error('This delegation is not for your current DID');
            }
            
            delegationInfo = {
              id: jsonDelegation.cid || crypto.randomUUID(),
              fromIssuer: jsonDelegation.issuer,
              toAudience: jsonDelegation.audience,
              proof: delegationProof,
              capabilities: Array.isArray(jsonDelegation.capabilities) 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? jsonDelegation.capabilities.map((cap: any) => cap.can || cap)
                : [],
              createdAt: new Date().toISOString(),
              format: 'fallback-json-format (base64-encoded)'
            };
          } else {
            throw new Error('Not recognized JSON format');
          }
        } catch {
          throw new Error('Not JSON format');
        }
        
      } catch (jsonError) {
        // Fallback: try to parse as CAR format (proper UCAN delegation)
        
        try {
          const carArrayBuffer = this.base64ToArrayBuffer(delegationProof);
          const carBytes = new Uint8Array(carArrayBuffer);
          
          const { extract } = await import('@ucanto/core/delegation');
          const extractResult = await extract(carBytes);
          
          // Handle ucanto Result format - check if it's {ok: Delegation} or {error: Error}
          let delegation;
          if (extractResult && extractResult.ok) {
            delegation = extractResult.ok;
          } else if (extractResult && !extractResult.error) {
            delegation = extractResult;
          } else {
            console.error('Extraction failed:', extractResult?.error);
            throw new Error('Failed to extract delegation from CAR data');
          }
          
          if (delegation && delegation.audience) {
            // Verify this delegation is for our DID
            const ourDid = this.getCurrentDID();
            const audienceDid = typeof delegation.audience.did === 'function' 
              ? delegation.audience.did() 
              : delegation.audience;
            const issuerDid = typeof delegation.issuer.did === 'function'
              ? delegation.issuer.did()
              : delegation.issuer;
            
            if (audienceDid !== ourDid) {
              throw new Error(`This delegation is not for your current DID. Expected: ${ourDid}, Got: ${audienceDid}`);
            }
            
            // Create delegation info from UCAN delegation
            delegationInfo = {
              id: delegation.cid?.toString() || crypto.randomUUID(),
              fromIssuer: String(issuerDid),
              toAudience: audienceDid,
              proof: delegationProof,
              capabilities: Array.isArray(delegation.capabilities) 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? delegation.capabilities.map((cap: any) => cap.can || cap.capability || cap)
                : ['space/blob/add', 'space/blob/list', 'space/blob/remove', 'store/add', 'store/list', 'store/remove', 'upload/add', 'upload/list', 'upload/remove'], // fallback capabilities
              createdAt: new Date().toISOString(),
              expiresAt: delegation.expiration ? new Date(delegation.expiration * 1000).toISOString() : undefined,
              format: 'car-format (base64-encoded CAR file)'
            };
          } else {
            throw new Error('Invalid UCAN delegation format - missing delegation or audience');
          }
        } catch (carError) {
          console.error('All parsing attempts failed');
          if (ucantoError) console.error('  ucanto extract:', ucantoError.message);
          if (storachaProofError) console.error('  Storacha Proof.parse:', storachaProofError.message);
          console.error('  Legacy JSON:', (jsonError as Error).message);
          console.error('  Legacy CAR:', (carError as Error).message);
          
          const primaryError = ucantoError?.message || storachaProofError?.message || 'Unknown error';
          throw new Error(`Invalid delegation format. Tried: ucanto extract, Storacha Proof.parse, and legacy formats. All failed. Primary error: ${primaryError}`);
        }
      }
      }

      // Store received delegation
      const stored = localStorage.getItem(STORAGE_KEYS.RECEIVED_DELEGATIONS);
      const delegations: DelegationInfo[] = stored ? JSON.parse(stored) : [];
      
      // Check if already exists
      if (delegations.find(d => d.id === delegationInfo.id)) {
        throw new Error('Delegation already imported');
      }

      delegations.unshift(delegationInfo);
      localStorage.setItem(STORAGE_KEYS.RECEIVED_DELEGATIONS, JSON.stringify(delegations));
      
      console.log('✅ Successfully imported delegation');
    } catch (error) {
      console.error('Failed to import delegation:', error);
      throw new Error(`Failed to import delegation: ${error}`);
    }
  }

  /**
   * Store a received delegation
   */
  private storeReceivedDelegation(delegation: DelegationInfo): void {
    const stored = localStorage.getItem(STORAGE_KEYS.RECEIVED_DELEGATIONS);
    const delegations: DelegationInfo[] = stored ? JSON.parse(stored) : [];
    
    // Check if already exists
    if (delegations.find(d => d.id === delegation.id)) {
      throw new Error('Delegation already imported');
    }
    
    delegations.unshift(delegation);
    localStorage.setItem(STORAGE_KEYS.RECEIVED_DELEGATIONS, JSON.stringify(delegations));
  }

  /**
   * Get all delegations we've received
   */
  getReceivedDelegations(): DelegationInfo[] {
    const stored = localStorage.getItem(STORAGE_KEYS.RECEIVED_DELEGATIONS);
    return stored ? JSON.parse(stored) : [];
  }

  /**
   * Delete all created delegations
   */
  clearCreatedDelegations(): void {
    localStorage.removeItem(STORAGE_KEYS.CREATED_DELEGATIONS);
    console.log('✅ Cleared all created delegations');
  }

  /**
   * Delete all received delegations
   */
  clearReceivedDelegations(): void {
    localStorage.removeItem(STORAGE_KEYS.RECEIVED_DELEGATIONS);
    console.log('✅ Cleared all received delegations');
  }

  /**
   * Clear old delegations and recreate with bridge pattern
   */
  async recreateDelegationWithBridgePattern(): Promise<void> {
    if (!this.webauthnProvider) {
      throw new Error('WebAuthn provider not initialized');
    }

    const credentials = this.getStorachaCredentials();
    if (!credentials) {
      throw new Error('No Storacha credentials found - need Browser A setup first');
    }

    const currentDID = this.getCurrentDID();
    if (!currentDID) {
      throw new Error('No current DID available');
    }

    try {
      console.log('Creating fresh bridge delegation...');
      
      // Clear old delegations
      localStorage.removeItem(STORAGE_KEYS.RECEIVED_DELEGATIONS);
      localStorage.removeItem(STORAGE_KEYS.CREATED_DELEGATIONS);
      
      // Create new bridge delegation with correct DID chain
      const delegationProof = await this.createDelegation(currentDID, ['space/blob/add', 'space/blob/list', 'space/blob/remove', 'store/add', 'store/list', 'store/remove', 'upload/add', 'upload/list', 'upload/remove']);
      
      // Import the fresh delegation
      await this.importDelegation(delegationProof);
      
      console.log('✅ Successfully recreated delegation with bridge pattern');
      
    } catch (error) {
      console.error('❌ Failed to recreate delegation:', error);
      throw error;
    }
  }

  /**
   * Check if a delegation has been revoked by querying Storacha's revocation registry
   * Uses caching to minimize API calls
   * @param delegationCID The CID of the delegation to check
   * @param forceRefresh Force a fresh check, bypassing cache
   * @returns True if the delegation is revoked
   */
  async isDelegationRevoked(delegationCID: string, forceRefresh = false): Promise<boolean> {
    const now = Date.now();
    
    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.getRevocationCache(delegationCID);
      if (cached && now - cached.checkedAt < 5 * 60 * 1000) { // Cache for 5 minutes
        console.log(`Using cached revocation status for ${delegationCID}: ${cached.revoked}`);
        return cached.revoked;
      }
    }
    
    try {
      console.log(`Checking revocation status for delegation: ${delegationCID}`);
      const response = await fetch(
        `https://up.storacha.network/revocations/${delegationCID}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        }
      );
      
      // If we get a 404, the delegation is not revoked
      if (response.status === 404) {
        this.setRevocationCache(delegationCID, false);
        return false;
      }
      
      if (!response.ok) {
        console.warn(`Failed to check revocation status: ${response.status} ${response.statusText}`);
        // If we can't check, assume not revoked (fail open for availability)
        return false;
      }
      
      const data = await response.json();
      const isRevoked = data?.revoked === true || data?.status === 'revoked';
      
      // Cache the result
      this.setRevocationCache(delegationCID, isRevoked);
      
      console.log(`Delegation ${delegationCID} revoked: ${isRevoked}`);
      return isRevoked;
      
    } catch (error) {
      console.error('Failed to check revocation status:', error);
      // If we can't reach the server, fail open (assume not revoked)
      return false;
    }
  }

  /**
   * Validate a delegation before use
   * Checks both expiration and revocation status
   * @param delegation The delegation to validate
   * @returns True if the delegation is valid (not expired and not revoked)
   */
  async validateDelegation(delegation: DelegationInfo): Promise<{ valid: boolean; reason?: string }> {
    // Check expiration
    if (delegation.expiresAt) {
      const expirationDate = new Date(delegation.expiresAt);
      if (expirationDate < new Date()) {
        console.warn(`Delegation ${delegation.id} has expired`);
        return { valid: false, reason: 'Delegation has expired' };
      }
    }
    
    // Check revocation status
    const isRevoked = await this.isDelegationRevoked(delegation.id);
    if (isRevoked) {
      console.warn(`Delegation ${delegation.id} has been revoked`);
      return { valid: false, reason: 'Delegation has been revoked' };
    }
    
    return { valid: true };
  }

  /**
   * Revoke a delegation that you created
   * This sends a revocation request to Storacha's service
   * @param delegationCID The CID of the delegation to revoke
   * @returns Success/error result
   */
  async revokeDelegation(delegationCID: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔄 Revoking delegation: ${delegationCID}`);
      
      // Find the delegation in created delegations
      const createdDelegations = this.getCreatedDelegations();
      const delegation = createdDelegations.find(d => d.id === delegationCID);
      
      if (!delegation) {
        return { success: false, error: 'Delegation not found in local store' };
      }
      
      // Parse the delegation proof to get the actual delegation object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsedDelegation = await this.parseDelegationProof(delegation.proof) as any;
      
      // Get the issuer principal (who created the delegation)
      const issuer = await this.getWorkerPrincipal();
      
      console.log(`Issuer DID: ${issuer.did()}`);
      console.log(`Delegation CID: ${parsedDelegation.cid.toString()}`);
      
      // Import required modules
      const { invoke } = await import('@ucanto/core');
      const UcantoClient = await import('@ucanto/client');
      const { CAR, HTTP } = await import('@ucanto/transport');
      const { Verifier } = await import('@ucanto/principal');
      
      // Parse the service DID properly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceID = Verifier.parse('did:web:up.storacha.network') as any;
      
      // Create the revocation invocation
      // Following Storacha's agent.js pattern
      const revocationInvocation = await invoke({
        issuer,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        audience: serviceID as any,
        capability: {
          can: 'ucan/revoke',
          with: issuer.did(),
          nb: {
            ucan: parsedDelegation.cid
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        proofs: [parsedDelegation] as any // Include the delegation being revoked as proof
      });
      
      console.log('📤 Sending revocation invocation to Storacha...');
      
      // Create connection to Storacha service (following agent.js pattern)
      const connection = UcantoClient.connect({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: serviceID as any,
        codec: CAR.outbound,
        channel: HTTP.open({
          url: new URL('https://up.storacha.network'),
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      });
      
      // Execute the invocation through the connection
      // Note: execute() returns an array of results, we want the first one
      const results = await connection.execute(revocationInvocation);
      const result = results[0];
      
      // Check if result exists and has out property
      if (!result || !result.out) {
        console.error('❌ Invalid response from Storacha:', results);
        return { success: false, error: 'Invalid response from Storacha service' };
      }
      
      if (result.out.error) {
        console.error('❌ Revocation failed:', result.out.error);
        return { success: false, error: result.out.error.message || 'Revocation failed' };
      }
      
      console.log('✅ Delegation revoked successfully');
      console.log('Response:', result.out);
      
      // Update local storage to mark as revoked
      const updatedDelegations = createdDelegations.map(d => {
        if (d.id === delegationCID) {
          return {
            ...d,
            revoked: true,
            revokedAt: new Date().toISOString(),
            revokedBy: issuer.did()
          };
        }
        return d;
      });
      
      localStorage.setItem(STORAGE_KEYS.CREATED_DELEGATIONS, JSON.stringify(updatedDelegations));
      
      // Update revocation cache
      this.setRevocationCache(delegationCID, true);
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Revocation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get revocation status from cache
   */
  private getRevocationCache(delegationCID: string): { revoked: boolean; checkedAt: number } | null {
    const cache = localStorage.getItem(STORAGE_KEYS.REVOCATION_CACHE);
    if (!cache) return null;
    
    try {
      const cacheData = JSON.parse(cache);
      return cacheData[delegationCID] || null;
    } catch {
      return null;
    }
  }

  /**
   * Set revocation status in cache
   */
  private setRevocationCache(delegationCID: string, revoked: boolean): void {
    const cache = localStorage.getItem(STORAGE_KEYS.REVOCATION_CACHE);
    let cacheData: Record<string, { revoked: boolean; checkedAt: number }> = {};
    
    if (cache) {
      try {
        cacheData = JSON.parse(cache);
      } catch {
        cacheData = {};
      }
    }
    
    cacheData[delegationCID] = {
      revoked,
      checkedAt: Date.now()
    };
    
    localStorage.setItem(STORAGE_KEYS.REVOCATION_CACHE, JSON.stringify(cacheData));
  }

  /**
   * Clear revocation cache
   */
  clearRevocationCache(): void {
    localStorage.removeItem(STORAGE_KEYS.REVOCATION_CACHE);
    console.log('✅ Cleared revocation cache');
  }

  /**
   * Clear Ed25519 keys and archive
   * Use this when there's a DID mismatch or corrupted archive
   */
  clearEd25519Keys(): void {
    localStorage.removeItem(STORAGE_KEYS.ED25519_KEYPAIR);
    localStorage.removeItem(STORAGE_KEYS.ED25519_ARCHIVE_ENCRYPTED);
    this.ed25519Keypair = null;
    this.ed25519Archive = null;
    console.log('✅ Cleared Ed25519 keys and archive');
  }

  /**
   * Clear all stored data
   */
  clearAll(): void {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    this.webauthnProvider = null;
    this.storachaClient = null;
    this.ed25519Keypair = null;
    this.ed25519Archive = null;
    console.log('✅ Cleared all stored data');
  }

  /**
   * Check if we have all necessary setup
   * Returns true if:
   * - We have Storacha credentials AND a WebAuthn DID (Browser A scenario)
   * - OR we have a WebAuthn DID AND received delegations (Browser B scenario)
   */
  isSetupComplete(): boolean {
    const hasCredentials = !!this.getStorachaCredentials();
    const hasDID = !!this.getCurrentDID();
    const hasReceivedDelegations = this.getReceivedDelegations().length > 0;
    
    // Browser A: Has both credentials and DID
    const isBrowserA = hasCredentials && hasDID;
    
    // Browser B: Has DID and received delegations (no need for credentials)
    const isBrowserB = hasDID && hasReceivedDelegations;
    
    return isBrowserA || isBrowserB;
  }


  /**
   * Utility: Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Utility: Convert base64url to standard base64
   */
  private base64urlToBase64(base64url: string): string {
    // Replace base64url chars with standard base64 chars
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    return base64;
  }

  /**
   * Utility: Convert base64 (or base64url) to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    // Handle base64url encoding (convert to standard base64 first)
    const standardBase64 = this.base64urlToBase64(base64);
    
    try {
      const binary = atob(standardBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    } catch {
      // If still fails, try without conversion (maybe it was already standard base64)
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
  }

  /**
   * Helper for Browser A: Create a proper bridge delegation for a specific target DID
   * This should be used when Browser B reports a DID mismatch
   */
  async createCorrectBridgeDelegation(targetDID: string): Promise<string> {
    const credentials = this.getStorachaCredentials();
    if (!credentials) {
      throw new Error('This method requires Storacha credentials (Browser A only)');
    }

    if (!this.webauthnProvider) {
      throw new Error('WebAuthn provider not initialized');
    }

    try {
      console.log('Creating correct bridge delegation for target DID:', targetDID);
      
      // Create bridge delegation with the exact target DID
      const delegationProof = await this.createDelegation(targetDID, [
        'space/blob/add',
        'space/blob/list',
        'space/blob/remove',
        'store/add',
        'store/list',
        'store/remove',
        'upload/add',
        'upload/list',
        'upload/remove'
      ]);
      
      console.log('✅ Bridge delegation created successfully!');
      
      return delegationProof;
      
    } catch (error) {
      console.error('❌ Failed to create bridge delegation:', error);
      throw error;
    }
  }

  /**
   * Create and test a fresh bridge delegation for the current WebAuthn DID
   * This is useful for testing if the bridge delegation pattern works
   */
  async createAndTestBridgeDelegation(): Promise<string | null> {
    if (!this.webauthnProvider) {
      throw new Error('WebAuthn provider not initialized');
    }

    const credentials = this.getStorachaCredentials();
    if (!credentials) {
      throw new Error('No Storacha credentials found');
    }

    try {
      console.log('Creating fresh bridge delegation for testing...');
      const currentDID = this.getCurrentDID();
      if (!currentDID) {
        throw new Error('No current DID available');
      }

      // Create a delegation to ourselves for testing
      const delegationProof = await this.createDelegation(currentDID, ['space/blob/add', 'space/blob/list', 'space/blob/remove', 'store/add', 'store/list', 'store/remove', 'upload/add', 'upload/list', 'upload/remove']);
      
      // Clear existing delegations and import the fresh one
      localStorage.removeItem(STORAGE_KEYS.RECEIVED_DELEGATIONS);
      await this.importDelegation(delegationProof);
      
      console.log('✅ Fresh bridge delegation imported successfully');
      return delegationProof;
      
    } catch (error) {
      console.error('❌ Failed to create fresh bridge delegation:', error);
      return null;
    }
  }
}
