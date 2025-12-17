/**
 * Simple Ed25519 DID helpers + web worker–based keystore.
 *
 * - DID helpers: pure Ed25519 did:key generation (no OrbitDB, no WebAuthn extras)
 * - Keystore: Ed25519 keypair + AES key live in a dedicated web worker
 *   with encrypt/decrypt/sign/verify APIs.
 *
 * The keystore uses an HKDF-based PRF to turn an input seed into a secret
 * AES-GCM key. Callers are free to derive that PRF seed however they like
 * (e.g. from WebAuthn credential data).
 *
 * All keystore operations log clearly to the browser console.
 */

import { varint } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import type {
  KeystoreRequestMessage,
  KeystoreResponseMessage
} from '../workers/ed25519-keystore.worker';

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  did: string;
}

// -----------------------------------------------------------------------------
// Legacy helpers (kept for backwards compatibility)
// -----------------------------------------------------------------------------

/**
 * Generate Ed25519 keypair using Web Crypto API.
 *
 * No WebAuthn or hardware-protection is applied here – callers are
 * responsible for storing the key material wherever they like.
 */
export async function generateEd25519KeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  try {
    // Use native Ed25519 support where available.
     
    const keyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' } as any,
      true,
      ['sign', 'verify']
    );

    const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    // Extract raw bytes (last 32 bytes of each)
    const publicKey = new Uint8Array(publicKeySpki).slice(-32);
    const privateKey = new Uint8Array(privateKeyPkcs8).slice(-32);

    return { publicKey, privateKey };
  } catch (error) {
    console.warn('Native Ed25519 not available, falling back to random bytes:', error);

    // Fallback: random private key, derive a stable public key via hash.
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
  if (publicKeyBytes.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${publicKeyBytes.length} bytes`);
  }

  // Ed25519 multicodec (0xed)
  const ED25519_MULTICODEC = 0xed;
  const codecLength = varint.encodingLength(ED25519_MULTICODEC);
  const codecBytes = new Uint8Array(codecLength);
  varint.encodeTo(ED25519_MULTICODEC, codecBytes, 0);

  // Combine multicodec + public key
  const multikey = new Uint8Array(codecBytes.length + publicKeyBytes.length);
  multikey.set(codecBytes, 0);
  multikey.set(publicKeyBytes, codecBytes.length);

  // Encode as base58btc
  const multikeyEncoded = base58btc.encode(multikey);
  return `did:key:${multikeyEncoded}`;
}

// -----------------------------------------------------------------------------
// Web worker–backed Ed25519 keystore
// -----------------------------------------------------------------------------

let keystoreWorker: Worker | null = null;
let nextRequestId = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (reason?: any) => void }>();

function getKeystoreWorker(): Worker {
  if (!keystoreWorker) {
    console.log('[secure-ed25519-did] 🧵 Spawning ed25519-keystore worker');
    keystoreWorker = new Worker(
      // Vite/ESM-friendly worker URL
      new URL('../workers/ed25519-keystore.worker.ts', import.meta.url),
      { type: 'module' }
    );

    keystoreWorker.onmessage = (event: MessageEvent<KeystoreResponseMessage>) => {
      const { id, ok, result, error } = event.data as any;
      const pending = pendingRequests.get(id);
      if (!pending) {
        console.warn('[secure-ed25519-did] ⚠️ Received response for unknown request id', id);
        return;
      }
      pendingRequests.delete(id);

      if (ok) {
        console.log('[secure-ed25519-did] ✅ Worker response', { id, result });
        pending.resolve(result);
      } else {
        console.error('[secure-ed25519-did] ❌ Worker error', { id, error });
        pending.reject(new Error(error));
      }
    };

    keystoreWorker.onerror = (event) => {
      console.error('[secure-ed25519-did] ❌ Worker error event', event.message);
    };
  }
  return keystoreWorker;
}

async function sendKeystoreRequest<T extends KeystoreRequestMessage['type']>(
  type: T,
  payload: Omit<Extract<KeystoreRequestMessage, { type: T }>, 'id' | 'type'>
): Promise<any> {
  const worker = getKeystoreWorker();
  const id = nextRequestId++;

  console.log('[secure-ed25519-did] 📤 Sending worker request', { id, type });

   
  const message: KeystoreRequestMessage = {
    id,
    type,
    ...(payload as any)
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promise = new Promise<any>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
  });

  worker.postMessage(message);
  return promise;
}

/**
 * Initialize the worker keystore with a PRF seed.
 *
 * The seed should already be the output of some PRF (e.g. derived from
 * WebAuthn credential material or another KDF). The worker will run an
 * HKDF-SHA-256 step over this seed to obtain an AES-GCM key.
 */
export async function initEd25519KeystoreWithPrfSeed(prfSeed: Uint8Array): Promise<void> {
  console.log('[secure-ed25519-did] ⚙️ initEd25519KeystoreWithPrfSeed() called', {
    seedLength: prfSeed.length
  });

  await sendKeystoreRequest('init', { prfSeed: prfSeed.buffer as ArrayBuffer });
  console.log('[secure-ed25519-did] ✅ Keystore initialized with PRF seed');
}

/**
 * Generate a new Ed25519 keypair inside the worker.
 * Returns the public key bytes and did:key; the private key never leaves
 * the worker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateWorkerEd25519DID(): Promise<{ publicKey: Uint8Array; did: string; archive: any }> {
  console.log('[secure-ed25519-did] 🔑 generateWorkerEd25519DID() called');

  const result = await sendKeystoreRequest('generateKeypair', {});
  const publicKey = new Uint8Array(result.publicKey as ArrayBuffer);
  const did = await createEd25519DID(publicKey);
  const archive = result.archive;

  console.log('[secure-ed25519-did] ✅ Worker Ed25519 DID generated', { did });
  return { publicKey, did, archive };
}

/**
 * Encrypt arbitrary bytes using the worker's AES-GCM key.
 */
export async function keystoreEncrypt(plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  console.log('[secure-ed25519-did] 🔒 keystoreEncrypt() called', { length: plaintext.length });

  const result = await sendKeystoreRequest('encrypt', { plaintext: plaintext.buffer as ArrayBuffer });
  const ciphertext = new Uint8Array(result.ciphertext as ArrayBuffer);
  const iv = new Uint8Array(result.iv as ArrayBuffer);

  console.log('[secure-ed25519-did] ✅ keystoreEncrypt() complete', {
    ciphertextLength: ciphertext.length,
    ivLength: iv.length
  });
  return { ciphertext, iv };
}

/**
 * Decrypt bytes using the worker's AES-GCM key.
 */
export async function keystoreDecrypt(ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  console.log('[secure-ed25519-did] 🔓 keystoreDecrypt() called', {
    ciphertextLength: ciphertext.length,
    ivLength: iv.length
  });

  const result = await sendKeystoreRequest('decrypt', {
    ciphertext: ciphertext.buffer as ArrayBuffer,
    iv: iv.buffer as ArrayBuffer
  });
  const plaintext = new Uint8Array(result.plaintext as ArrayBuffer);

  console.log('[secure-ed25519-did] ✅ keystoreDecrypt() complete', { length: plaintext.length });
  return plaintext;
}

/**
 * Sign bytes using the worker-held Ed25519 private key.
 */
export async function keystoreSign(data: Uint8Array): Promise<Uint8Array> {
  console.log('[secure-ed25519-did] ✍️ keystoreSign() called', { length: data.length });

  const result = await sendKeystoreRequest('sign', { data: data.buffer as ArrayBuffer });
  const signature = new Uint8Array(result.signature as ArrayBuffer);

  console.log('[secure-ed25519-did] ✅ keystoreSign() complete', { length: signature.length });
  return signature;
}

/**
 * Verify a signature using the worker-held Ed25519 public key.
 */
export async function keystoreVerify(data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  console.log('[secure-ed25519-did] ✅ keystoreVerify() called', {
    dataLength: data.length,
    sigLength: signature.length
  });

  const result = await sendKeystoreRequest('verify', {
    data: data.buffer as ArrayBuffer,
    signature: signature.buffer as ArrayBuffer
  });

  const { valid } = result as { valid: boolean };
  console.log('[secure-ed25519-did] ✅ keystoreVerify() result', { valid });
  return valid;
}

/**
 * Encrypt an Ed25519 archive object using the worker's AES key.
 * The archive is serialized to JSON (Uint8Array -> array) before encryption.
 * 
 * @param archive - Ed25519Signer archive with id and keys
 * @returns Encrypted ciphertext and IV
 */
export async function encryptArchive(archive: { id: string; keys: Record<string, Uint8Array> }): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  console.log('[secure-ed25519-did] 🔒 encryptArchive() called');
  
  // Serialize archive: convert Uint8Array values to arrays for JSON
  const serialized = {
    id: archive.id,
    keys: Object.fromEntries(
      Object.entries(archive.keys).map(([did, bytes]) => [did, Array.from(bytes)])
    )
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(serialized));
  
  const result = await keystoreEncrypt(jsonBytes);
  console.log('[secure-ed25519-did] ✅ encryptArchive() complete');
  return result;
}

/**
 * Decrypt an Ed25519 archive object using the worker's AES key.
 * The decrypted JSON is deserialized back to the archive format (array -> Uint8Array).
 * 
 * @param ciphertext - Encrypted archive bytes
 * @param iv - Initialization vector used for encryption
 * @returns Decrypted Ed25519Signer archive
 */
export async function decryptArchive(ciphertext: Uint8Array, iv: Uint8Array): Promise<{ id: string; keys: Record<string, Uint8Array> }> {
  console.log('[secure-ed25519-did] 🔓 decryptArchive() called');
  
  const jsonBytes = await keystoreDecrypt(ciphertext, iv);
  const jsonText = new TextDecoder().decode(jsonBytes);
  const serialized = JSON.parse(jsonText);
  
  // Deserialize: convert arrays back to Uint8Array
  const archive = {
    id: serialized.id,
    keys: Object.fromEntries(
      Object.entries(serialized.keys).map(([did, arr]) => [did, new Uint8Array(arr as number[])])
    )
  };
  
  console.log('[secure-ed25519-did] ✅ decryptArchive() complete');
  return archive;
}

