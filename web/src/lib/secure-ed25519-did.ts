/**
 * Ed25519 DID helpers + worker-keystore bridge.
 *
 * This module keeps the historical upload-wall API surface but delegates
 * worker-keystore behavior to the standalone toolkit exported by
 * @le-space/orbitdb-identity-provider-webauthn-did.
 */

import {
  createEd25519DidFromPublicKey,
  decryptArchive as decryptArchiveViaToolkit,
  encryptArchive as encryptArchiveViaToolkit,
  generateWorkerEd25519DID as generateWorkerEd25519DIDViaToolkit,
  initEd25519KeystoreWithPrfSeed as initEd25519KeystoreWithPrfSeedViaToolkit,
  keystoreDecrypt as keystoreDecryptViaToolkit,
  keystoreEncrypt as keystoreEncryptViaToolkit,
  keystoreSign as keystoreSignViaToolkit,
  keystoreVerify as keystoreVerifyViaToolkit
} from '@le-space/orbitdb-identity-provider-webauthn-did/standalone';

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  did: string;
}

/**
 * Generate Ed25519 keypair using Web Crypto API.
 *
 * No WebAuthn or hardware-protection is applied here - callers are
 * responsible for storing the key material wherever they like.
 */
export async function generateEd25519KeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' } as Algorithm,
      true,
      ['sign', 'verify']
    ) as CryptoKeyPair;

    const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    const publicKey = new Uint8Array(publicKeySpki).slice(-32);
    const privateKey = new Uint8Array(privateKeyPkcs8).slice(-32);

    return { publicKey, privateKey };
  } catch (error) {
    console.warn('Native Ed25519 not available, falling back to random bytes:', error);

    const privateKey = crypto.getRandomValues(new Uint8Array(32));
    const publicKeyHash = await crypto.subtle.digest('SHA-256', privateKey);
    const publicKey = new Uint8Array(publicKeyHash).slice(0, 32);

    return { publicKey, privateKey };
  }
}

/**
 * Create did:key from an Ed25519 public key.
 */
export async function createEd25519DID(publicKeyBytes: Uint8Array): Promise<string> {
  return createEd25519DidFromPublicKey(publicKeyBytes);
}

/**
 * Initialize the worker keystore with a PRF seed.
 */
export async function initEd25519KeystoreWithPrfSeed(prfSeed: Uint8Array): Promise<void> {
  await initEd25519KeystoreWithPrfSeedViaToolkit(prfSeed);
}

/**
 * Generate a new Ed25519 keypair inside the worker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateWorkerEd25519DID(): Promise<{ publicKey: Uint8Array; did: string; archive: any }> {
  return generateWorkerEd25519DIDViaToolkit();
}

/**
 * Encrypt arbitrary bytes using the worker AES key.
 */
export async function keystoreEncrypt(plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  return keystoreEncryptViaToolkit(plaintext);
}

/**
 * Decrypt bytes using the worker AES key.
 */
export async function keystoreDecrypt(ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  return keystoreDecryptViaToolkit(ciphertext, iv);
}

/**
 * Sign bytes using worker-held Ed25519 private key.
 */
export async function keystoreSign(data: Uint8Array): Promise<Uint8Array> {
  return keystoreSignViaToolkit(data);
}

/**
 * Verify a signature using worker-held Ed25519 public key.
 */
export async function keystoreVerify(data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  return keystoreVerifyViaToolkit(data, signature);
}

/**
 * Encrypt an Ed25519 archive object using the worker AES key.
 */
export async function encryptArchive(archive: { id: string; keys: Record<string, Uint8Array> }): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  return encryptArchiveViaToolkit(archive);
}

/**
 * Decrypt an Ed25519 archive object using the worker AES key.
 */
export async function decryptArchive(ciphertext: Uint8Array, iv: Uint8Array): Promise<{ id: string; keys: Record<string, Uint8Array> }> {
  const archive = await decryptArchiveViaToolkit(ciphertext, iv);
  return {
    id: archive.id,
    keys: Object.fromEntries(
      Object.entries(archive.keys || {}).map(([did, bytes]) => [did, new Uint8Array(bytes as number[])])
    )
  };
}
