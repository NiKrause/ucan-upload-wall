declare module '@le-space/orbitdb-identity-provider-webauthn-did/standalone' {
  export class StandaloneWebAuthnVarsigSigner {
    constructor(credential: {
      credentialId: Uint8Array | ArrayBuffer;
      did: string;
      publicKey: Uint8Array;
      algorithm: 'Ed25519' | 'P-256';
      cose?: unknown;
    });
    did: string;
    publicKey: Uint8Array;
    algorithm: 'Ed25519' | 'P-256';
    sign(data: Uint8Array | string): Promise<Uint8Array>;
    verify(signature: Uint8Array, data: Uint8Array | string): Promise<boolean>;
    getCredentialId(): Uint8Array;
    toUcantoSigner(): unknown;
  }

  export class WebAuthnEd25519Signer extends StandaloneWebAuthnVarsigSigner {
    constructor(credentialId: Uint8Array | ArrayBuffer, did: string, publicKey: Uint8Array);
  }

  export class WebAuthnP256Signer extends StandaloneWebAuthnVarsigSigner {
    constructor(credentialId: Uint8Array | ArrayBuffer, did: string, publicKey: Uint8Array);
  }

  export function createWebAuthnEd25519Credential(
    userId: string,
    displayName: string,
    options?: { authenticatorType?: 'platform' | 'cross-platform' | 'any' }
  ): Promise<StandaloneWebAuthnVarsigSigner | null>;
  export function checkEd25519Support(): Promise<boolean>;
  export function storeWebAuthnCredentialSafe(credential: unknown, key?: string): void;
  export function loadWebAuthnCredentialSafe<T = unknown>(key?: string): T | null;
  export function clearWebAuthnCredentialSafe(key?: string): void;
  export function extractPrfSeedFromCredential(
    credential: {
      rawCredentialId?: Uint8Array;
      credentialId?: Uint8Array | string;
      prfInput?: Uint8Array;
    },
    options?: {
      rpId?: string;
      prfInput?: Uint8Array;
    }
  ): Promise<{ seed: Uint8Array; source: 'prf' | 'credentialId' }>;

  export function createEd25519DidFromPublicKey(publicKeyBytes: Uint8Array): string;

  export function initEd25519KeystoreWithPrfSeed(prfSeed: Uint8Array): Promise<void>;
  export function generateWorkerEd25519DID(): Promise<{
    did: string;
    publicKey: Uint8Array;
    archive: unknown;
  }>;
  export function keystoreEncrypt(plaintext: Uint8Array): Promise<{
    ciphertext: Uint8Array;
    iv: Uint8Array;
  }>;
  export function keystoreDecrypt(ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array>;
  export function keystoreSign(data: Uint8Array): Promise<Uint8Array>;
  export function keystoreVerify(data: Uint8Array, signature: Uint8Array): Promise<boolean>;
  export function encryptArchive(archive: unknown): Promise<{
    ciphertext: Uint8Array;
    iv: Uint8Array;
  }>;
  export function decryptArchive(ciphertext: Uint8Array, iv: Uint8Array): Promise<{
    id: string;
    keys: Record<string, Uint8Array | number[]>;
  }>;
}
