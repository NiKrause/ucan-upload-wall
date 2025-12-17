 

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

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let ed25519KeyPair: CryptoKeyPair | null = null;
let aesKey: CryptoKey | null = null;

ctx.console.log('[ed25519-keystore.worker] 🧵 Worker started');

async function deriveAesKeyFromPrfSeed(prfSeed: ArrayBuffer): Promise<CryptoKey> {
  ctx.console.log('[ed25519-keystore.worker] 🔐 Deriving AES key from PRF seed (HKDF-SHA-256)');

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

  ctx.console.log('[ed25519-keystore.worker] ✅ AES key derived');
  return derivedKey;
}

async function handleMessage(event: MessageEvent<KeystoreRequestMessage>): Promise<void> {
  const msg = event.data;
  const { id } = msg;

  try {
    switch (msg.type) {
      case 'init': {
        ctx.console.log('[ed25519-keystore.worker] ⚙️ init() called');
        aesKey = await deriveAesKeyFromPrfSeed(msg.prfSeed);
        ctx.console.log('[ed25519-keystore.worker] ✅ init() complete');
        ctx.postMessage({ id, ok: true } as KeystoreSuccessResponse);
        break;
      }

      case 'generateKeypair': {
        ctx.console.log('[ed25519-keystore.worker] 🔑 generateKeypair() called');
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ed25519KeyPair = await crypto.subtle.generateKey(
          { name: 'Ed25519' } as any,
          true,
          ['sign', 'verify']
        );

        // Export public key (for DID) and private key bytes (for Ed25519Signer archive)
        const publicKeySpki = await crypto.subtle.exportKey('spki', ed25519KeyPair.publicKey);
        const publicKeyBytes = new Uint8Array(publicKeySpki).slice(-32);

        const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', ed25519KeyPair.privateKey);
        const secret = new Uint8Array(privateKeyPkcs8).slice(-32);

        // Build a real Ed25519Signer and its archive, matching @ucanto/principal/ed25519
        const edSigner = await deriveEdSigner(secret);
        const encoded = encodeEdSigner(edSigner); // contains private + public with multicodec tags
        const archive = edSigner.toArchive();

        ctx.console.log('[ed25519-keystore.worker] ✅ Ed25519 keypair generated and archived');
        ctx.postMessage({
          id,
          ok: true,
          result: {
            publicKey: publicKeyBytes.buffer,
            signerBytes: encoded.buffer,
            archive
          }
        } as KeystoreSuccessResponse, [publicKeyBytes.buffer, encoded.buffer]);
        break;
      }

      case 'encrypt': {
        if (!aesKey) {
          throw new Error('Keystore not initialized: AES key missing');
        }
        ctx.console.log('[ed25519-keystore.worker] 🔒 encrypt() called');

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          aesKey,
          msg.plaintext
        );

        ctx.console.log('[ed25519-keystore.worker] ✅ encrypt() complete');
        const ivBuf = iv.buffer.slice(0);
        ctx.postMessage(
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
        ctx.console.log('[ed25519-keystore.worker] 🔓 decrypt() called');

        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: msg.iv },
          aesKey,
          msg.ciphertext
        );

        ctx.console.log('[ed25519-keystore.worker] ✅ decrypt() complete');
        ctx.postMessage(
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
        if (!ed25519KeyPair) {
          throw new Error('Ed25519 keypair not generated yet');
        }
        ctx.console.log('[ed25519-keystore.worker] ✍️ sign() called');

         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const signature = await crypto.subtle.sign(
          { name: 'Ed25519' } as any,
          ed25519KeyPair.privateKey,
          msg.data
        );

        ctx.console.log('[ed25519-keystore.worker] ✅ sign() complete');
        ctx.postMessage(
          {
            id,
            ok: true,
            result: { signature }
          } as KeystoreSuccessResponse,
          [signature]
        );
        break;
      }

      case 'verify': {
        if (!ed25519KeyPair) {
          throw new Error('Ed25519 keypair not generated yet');
        }
        ctx.console.log('[ed25519-keystore.worker] ✅ verify() called');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const valid = await crypto.subtle.verify(
          { name: 'Ed25519' } as any,
          ed25519KeyPair.publicKey,
          msg.signature,
          msg.data
        );

        ctx.console.log('[ed25519-keystore.worker] ✅ verify() result:', valid);
        ctx.postMessage({
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
    ctx.console.error('[ed25519-keystore.worker] ❌ Error handling message', msg.type, err);
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    } as KeystoreErrorResponse);
  }
}

ctx.onmessage = (event: MessageEvent) => {
   
  handleMessage(event as MessageEvent<KeystoreRequestMessage>);
};

