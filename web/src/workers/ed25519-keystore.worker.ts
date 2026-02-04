/// <reference lib="webworker" />

import { derive as deriveEdSigner, encode as encodeEdSigner } from '@ucanto/principal/ed25519';

/**
 * Ed25519 keystore web worker.
 *
 * - Generates and holds an Ed25519 keypair in worker memory
 * - Derives an AES-GCM key from a PRF seed
 * - Exposes encrypt/decrypt/sign/verify via postMessage
 *
 * Everything is logged clearly to the browser console (worker context).
 */

export interface KeystoreInitMessage {
  type: 'init';
  id: number;
  prfSeed: ArrayBuffer;
}

export interface KeystoreGenerateMessage {
  type: 'generateKeypair';
  id: number;
}

export interface KeystoreEncryptMessage {
  type: 'encrypt';
  id: number;
  plaintext: ArrayBuffer;
}

export interface KeystoreDecryptMessage {
  type: 'decrypt';
  id: number;
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
}

export interface KeystoreSignMessage {
  type: 'sign';
  id: number;
  data: ArrayBuffer;
}

export interface KeystoreVerifyMessage {
  type: 'verify';
  id: number;
  data: ArrayBuffer;
  signature: ArrayBuffer;
}

export type KeystoreRequestMessage =
  | KeystoreInitMessage
  | KeystoreGenerateMessage
  | KeystoreEncryptMessage
  | KeystoreDecryptMessage
  | KeystoreSignMessage
  | KeystoreVerifyMessage;

export interface KeystoreSuccessResponse {
  id: number;
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

export interface KeystoreErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export type KeystoreResponseMessage = KeystoreSuccessResponse | KeystoreErrorResponse;

declare const self: DedicatedWorkerGlobalScope;

let aesKey: CryptoKey | null = null;
let storedPrfSeed: ArrayBuffer | null = null;

console.log('[ed25519-keystore.worker] 🧵 Worker started');

async function deriveAesKeyFromPrfSeed(prfSeed: ArrayBuffer): Promise<CryptoKey> {
  console.log('[ed25519-keystore.worker] 🔐 Deriving AES key from PRF seed (HKDF-SHA-256)');

  // Derive salt deterministically from PRF seed to ensure same seed → same AES key
  // This allows encrypted archives to be decrypted on subsequent runs
  const saltHash = await crypto.subtle.digest('SHA-256', prfSeed);
  const salt = new Uint8Array(saltHash).slice(0, 16); // Use first 16 bytes as salt
  const info = new TextEncoder().encode('ucan-upload-wall/ed25519-keystore');

  const baseKey = await crypto.subtle.importKey(
    'raw',
    prfSeed,
    'HKDF',
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );

  console.log('[ed25519-keystore.worker] ✅ AES key derived');
  return derivedKey;
}

async function handleMessage(event: MessageEvent<KeystoreRequestMessage>): Promise<void> {
  const msg = event.data;
  const { id } = msg;

  try {
    switch (msg.type) {
      case 'init': {
        console.log('[ed25519-keystore.worker] ⚙️ init() called');
        storedPrfSeed = msg.prfSeed; // Store PRF seed for deterministic key generation
        aesKey = await deriveAesKeyFromPrfSeed(msg.prfSeed);
        console.log('[ed25519-keystore.worker] ✅ init() complete');
        self.postMessage({ id, ok: true } as KeystoreSuccessResponse);
        break;
      }

      case 'generateKeypair': {
        console.log('[ed25519-keystore.worker] 🔑 generateKeypair() called - generating deterministic keypair from PRF seed');
        
        if (!storedPrfSeed) {
          throw new Error('Keystore not initialized: PRF seed required for deterministic key generation');
        }
        
        // Generate deterministic Ed25519 private key from PRF seed using HKDF
        const baseKey = await crypto.subtle.importKey(
          'raw',
          storedPrfSeed,
          'HKDF',
          false,
          ['deriveKey', 'deriveBits']
        );
        
        const privateKeyBytes = await crypto.subtle.deriveBits(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new TextEncoder().encode('ucan-upload-wall-ed25519-private'),
            info: new TextEncoder().encode('ed25519-deterministic-key')
          },
          baseKey,
          256 // 32 bytes * 8 bits
        );
        
        const secret = new Uint8Array(privateKeyBytes);
        console.log('[ed25519-keystore.worker] 🔑 Generated deterministic Ed25519 private key from PRF seed');
        
        // Build a real Ed25519Signer from the deterministic secret
        const edSigner = await deriveEdSigner(secret);
        const encoded = encodeEdSigner(edSigner);
        const archive = edSigner.toArchive();
        
        // Extract public key from the signer's DID
        const did = edSigner.did();
        console.log('[ed25519-keystore.worker] 🔑 Generated deterministic DID:', did);
        
        // Extract public key bytes from the encoded signer
        const publicKey = encoded.slice(-32); // Last 32 bytes should be the public key
        
        // Don't create Web Crypto keys - just use the ucanto signer for everything
        // Store the signer for signing operations
        const signerData = {
          secret,
          publicKey,
          did,
          signer: edSigner
        };
        
        // Store signer data globally in worker for signing operations
        (globalThis as any).ed25519Signer = signerData;

        console.log('[ed25519-keystore.worker] ✅ Deterministic Ed25519 keypair generated and archived');
        
        self.postMessage({
          id,
          ok: true,
          result: {
            publicKey: publicKey.buffer,
            signerBytes: encoded.buffer,
            archive
          }
        } as KeystoreSuccessResponse, [publicKey.buffer, encoded.buffer]);
        break;
      }

      case 'encrypt': {
        if (!aesKey) {
          throw new Error('Keystore not initialized: AES key missing');
        }
        console.log('[ed25519-keystore.worker] 🔒 encrypt() called');

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          aesKey,
          msg.plaintext
        );

        console.log('[ed25519-keystore.worker] ✅ encrypt() complete');
        const ivBuf = iv.buffer.slice(0);
        self.postMessage(
          {
            id,
            ok: true,
            result: { ciphertext, iv: ivBuf }
          } as KeystoreSuccessResponse,
          [ciphertext, ivBuf]
        );
        break;
      }

      case 'decrypt': {
        if (!aesKey) {
          throw new Error('Keystore not initialized: AES key missing');
        }
        console.log('[ed25519-keystore.worker] 🔓 decrypt() called');

        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: msg.iv },
          aesKey,
          msg.ciphertext
        );

        console.log('[ed25519-keystore.worker] ✅ decrypt() complete');
        self.postMessage(
          {
            id,
            ok: true,
            result: { plaintext }
          } as KeystoreSuccessResponse,
          [plaintext]
        );
        break;
      }

      case 'sign': {
        const signerData = (globalThis as any).ed25519Signer;
        if (!signerData) {
          throw new Error('Ed25519 signer not generated yet');
        }
        console.log('[ed25519-keystore.worker] ✍️ sign() called - using ucanto Ed25519Signer');

        // Use the ucanto signer for signing
        const signature = await signerData.signer.sign(new Uint8Array(msg.data));

        console.log('[ed25519-keystore.worker] ✅ sign() complete');
        self.postMessage(
          {
            id,
            ok: true,
            result: { signature: signature.buffer }
          } as KeystoreSuccessResponse,
          [signature.buffer]
        );
        break;
      }

      case 'verify': {
        const signerData = (globalThis as any).ed25519Signer;
        if (!signerData) {
          throw new Error('Ed25519 signer not generated yet');
        }
        console.log('[ed25519-keystore.worker] ✅ verify() called - using ucanto Ed25519Signer');

        // Use the ucanto signer for verification
        const valid = await signerData.signer.verify(new Uint8Array(msg.data), new Uint8Array(msg.signature));

        console.log('[ed25519-keystore.worker] ✅ verify() result:', valid);
        self.postMessage({
          id,
          ok: true,
          result: { valid }
        } as KeystoreSuccessResponse);
        break;
      }

      default: {
        const exhaustiveCheck: never = msg;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw new Error(`Unknown message type: ${(exhaustiveCheck as any).type}`);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[ed25519-keystore.worker] ❌ Error handling message', msg.type, err);
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    } as KeystoreErrorResponse);
  }
}

self.onmessage = (event: MessageEvent) => {
   
  handleMessage(event as MessageEvent<KeystoreRequestMessage>);
};

