/// <reference lib="webworker" />

import { derive as deriveEdSigner, encode as encodeEdSigner } from '@ucanto/principal/ed25519';

/**
 * Ed25519 keystore web worker.
 *
 * Notes:
 * - This file is intentionally plain JS (no TypeScript syntax), because some Vite worker
 *   pipelines can end up shipping the worker source without TS transpilation.
 * - The main thread owns the TS types in `ed25519-keystore.worker-types.ts`.
 */

/** @type {DedicatedWorkerGlobalScope} */
// eslint-disable-next-line no-undef
const workerScope = self;

/** @type {CryptoKeyPair|null} */
let ed25519KeyPair = null;
/** @type {CryptoKey|null} */
let aesKey = null;

console.log('[ed25519-keystore.worker] 🧵 Worker started');

/**
 * @param {ArrayBuffer} prfSeed
 * @returns {Promise<CryptoKey>}
 */
async function deriveAesKeyFromPrfSeed(prfSeed) {
  console.log('[ed25519-keystore.worker] 🔐 Deriving AES key from PRF seed (HKDF-SHA-256)');

  const saltHash = await crypto.subtle.digest('SHA-256', prfSeed);
  const salt = new Uint8Array(saltHash).slice(0, 16);
  const info = new TextEncoder().encode('ucan-upload-wall/ed25519-keystore');

  const baseKey = await crypto.subtle.importKey('raw', prfSeed, 'HKDF', false, ['deriveKey']);

  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  console.log('[ed25519-keystore.worker] ✅ AES key derived');
  return derivedKey;
}

/**
 * @param {MessageEvent} event
 */
async function handleMessage(event) {
  const msg = event.data;
  const id = msg && msg.id;

  try {
    switch (msg.type) {
      case 'init': {
        console.log('[ed25519-keystore.worker] ⚙️ init() called');
        aesKey = await deriveAesKeyFromPrfSeed(msg.prfSeed);
        console.log('[ed25519-keystore.worker] ✅ init() complete');
        workerScope.postMessage({ id, ok: true });
        break;
      }

      case 'generateKeypair': {
        console.log('[ed25519-keystore.worker] 🔑 generateKeypair() called');

        ed25519KeyPair = await crypto.subtle.generateKey(
          { name: 'Ed25519' },
          true,
          ['sign', 'verify']
        );

        const publicKeySpki = await crypto.subtle.exportKey('spki', ed25519KeyPair.publicKey);
        const publicKey = new Uint8Array(publicKeySpki).slice(-32);

        // Build a real Ed25519Signer and its archive, matching @ucanto/principal/ed25519
        const signer = deriveEdSigner(ed25519KeyPair.privateKey);
        const archive = encodeEdSigner(signer);

        console.log('[ed25519-keystore.worker] ✅ Ed25519 keypair generated and archived');
        workerScope.postMessage({
          id,
          ok: true,
          result: { publicKey: publicKey.buffer, archive }
        });
        break;
      }

      case 'encrypt': {
        console.log('[ed25519-keystore.worker] 🔒 encrypt() called');
        if (!aesKey) throw new Error('Keystore not initialized (aesKey missing). Call init first.');

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          aesKey,
          msg.plaintext
        );

        console.log('[ed25519-keystore.worker] ✅ encrypt() complete');
        workerScope.postMessage({
          id,
          ok: true,
          result: { ciphertext, iv: iv.buffer }
        });
        break;
      }

      case 'decrypt': {
        console.log('[ed25519-keystore.worker] 🔓 decrypt() called');
        if (!aesKey) throw new Error('Keystore not initialized (aesKey missing). Call init first.');

        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(msg.iv) },
          aesKey,
          msg.ciphertext
        );

        console.log('[ed25519-keystore.worker] ✅ decrypt() complete');
        workerScope.postMessage({ id, ok: true, result: { plaintext } });
        break;
      }

      case 'sign': {
        console.log('[ed25519-keystore.worker] ✍️ sign() called');
        if (!ed25519KeyPair) throw new Error('Keypair not generated. Call generateKeypair first.');

        const signature = await crypto.subtle.sign('Ed25519', ed25519KeyPair.privateKey, msg.data);
        console.log('[ed25519-keystore.worker] ✅ sign() complete');
        workerScope.postMessage({ id, ok: true, result: { signature } });
        break;
      }

      case 'verify': {
        console.log('[ed25519-keystore.worker] ✅ verify() called');
        if (!ed25519KeyPair) throw new Error('Keypair not generated. Call generateKeypair first.');

        const valid = await crypto.subtle.verify(
          'Ed25519',
          ed25519KeyPair.publicKey,
          msg.signature,
          msg.data
        );

        console.log('[ed25519-keystore.worker] ✅ verify() result:', valid);
        workerScope.postMessage({ id, ok: true, result: { valid } });
        break;
      }

      default: {
        throw new Error(`Unknown message type: ${msg && msg.type}`);
      }
    }
  } catch (err) {
    console.error('[ed25519-keystore.worker] ❌ Error handling message', msg && msg.type, err);
    workerScope.postMessage({
      id: typeof id === 'number' ? id : -1,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

workerScope.addEventListener('message', (event) => {
  void handleMessage(event);
});

