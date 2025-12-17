/**
 * TypeScript declarations for @le-space/orbitdb-identity-provider-webauthn-did
 * The package is written in JavaScript, so we provide type definitions here
 */

declare module '@le-space/orbitdb-identity-provider-webauthn-did' {
  // WebAuthn Credential Info
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
    attestationObject?: Uint8Array;
  }

  // WebAuthn DID Provider
  export class WebAuthnDIDProvider {
    credentialId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publicKey: any;
    rawCredentialId: Uint8Array;
    
    constructor(credentialInfo: WebAuthnCredentialInfo);
    
    static isSupported(): boolean;
    static isPlatformAuthenticatorAvailable(): Promise<boolean>;
    static createCredential(options?: {
      userId?: string;
      displayName?: string;
      domain?: string;
      encryptKeystore?: boolean;
      keystoreEncryptionMethod?: 'largeBlob' | 'hmac-secret';
    }): Promise<WebAuthnCredentialInfo>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static extractPublicKey(credential: PublicKeyCredential): Promise<any>;
    static createDID(credentialInfo: Omit<WebAuthnCredentialInfo, 'attestationObject'>): Promise<string>;
    static arrayBufferToBase64url(buffer: ArrayBuffer): string;
    static base64urlToArrayBuffer(base64url: string): ArrayBuffer;
    
    sign(data: string | Uint8Array): Promise<string>;
    verify(signatureData: string): Promise<boolean>;
  }

  // Credential Storage
  export function storeWebAuthnCredential(credential: WebAuthnCredentialInfo, key?: string): void;
  export function loadWebAuthnCredential(key?: string): WebAuthnCredentialInfo | null;
  export function clearWebAuthnCredential(key?: string): void;
  export function checkWebAuthnSupport(): Promise<{
    supported: boolean;
    platformAuthenticator: boolean;
    error: string | null;
    message: string;
  }>;

  // Keystore Encryption
  export function generateSecretKey(): Uint8Array;
  export function encryptWithAESGCM(
    data: Uint8Array,
    sk: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }>;
  export function decryptWithAESGCM(
    ciphertext: Uint8Array,
    sk: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array>;
  
  // WebAuthn Extensions
  export function retrieveSKFromLargeBlob(
    credentialId: Uint8Array,
    rpId: string
  ): Promise<Uint8Array>;
  export function wrapSKWithHmacSecret(
    credentialId: Uint8Array,
    sk: Uint8Array,
    rpId: string
  ): Promise<{ wrappedSK: Uint8Array; wrappingIV: Uint8Array; salt: Uint8Array }>;
  export function unwrapSKWithHmacSecret(
    credentialId: Uint8Array,
    wrappedSK: Uint8Array,
    wrappingIV: Uint8Array,
    salt: Uint8Array,
    rpId: string
  ): Promise<Uint8Array>;
  
  // Storage
  export function storeEncryptedKeystore(data: any, credentialId: string): Promise<void>;
  export function loadEncryptedKeystore(credentialId: string): Promise<any>;
  export function clearEncryptedKeystore(credentialId: string): Promise<void>;
  export function checkExtensionSupport(): Promise<{
    largeBlob: boolean;
    hmacSecret: boolean;
  }>;

  // Namespaces
  export const KeystoreEncryption: {
    generateSecretKey: typeof generateSecretKey;
    encryptWithAESGCM: typeof encryptWithAESGCM;
    decryptWithAESGCM: typeof decryptWithAESGCM;
    retrieveSKFromLargeBlob: typeof retrieveSKFromLargeBlob;
    wrapSKWithHmacSecret: typeof wrapSKWithHmacSecret;
    unwrapSKWithHmacSecret: typeof unwrapSKWithHmacSecret;
    storeEncryptedKeystore: typeof storeEncryptedKeystore;
    loadEncryptedKeystore: typeof loadEncryptedKeystore;
    clearEncryptedKeystore: typeof clearEncryptedKeystore;
    checkExtensionSupport: typeof checkExtensionSupport;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const VerificationUtils: any;

  // Default export
  const _default: {
    WebAuthnDIDProvider: typeof WebAuthnDIDProvider;
    storeWebAuthnCredential: typeof storeWebAuthnCredential;
    loadWebAuthnCredential: typeof loadWebAuthnCredential;
    clearWebAuthnCredential: typeof clearWebAuthnCredential;
    checkWebAuthnSupport: typeof checkWebAuthnSupport;
    VerificationUtils: typeof VerificationUtils;
  };
  export default _default;
}
