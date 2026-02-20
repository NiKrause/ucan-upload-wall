/**
 * Toolkit-backed WebAuthn DID compatibility layer.
 *
 * Uses standalone toolkit APIs only so upload-wall does not depend on
 * OrbitDB provider internals at runtime.
 */

import { bytesToBase64url } from 'iso-webauthn-varsig';
import {
  createWebAuthnSigner,
  clearWebAuthnCredentialSafe,
  extractPrfSeedFromCredential,
  loadWebAuthnCredentialSafe,
  storeWebAuthnCredentialSafe
} from '@le-space/orbitdb-identity-provider-webauthn-did/standalone';

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
  prfInput?: Uint8Array;
  prfSeed?: Uint8Array;
  prfSource?: 'prf' | 'credentialId';
  keyAlgorithm?: 'Ed25519' | 'P-256';
  isNativeEd25519?: boolean;
  attestationObject?: Uint8Array;
}

const STORAGE_KEY = 'webauthn_credential_info';

function hasWebAuthn(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

function toP256LikePublicKey(publicKey: Uint8Array): WebAuthnCredentialInfo['publicKey'] {
  // Native P-256 from varsig credential is uncompressed: 0x04 || x || y
  if (publicKey.length === 65 && publicKey[0] === 0x04) {
    return {
      algorithm: -7,
      x: publicKey.slice(1, 33),
      y: publicKey.slice(33, 65),
      keyType: 2,
      curve: 1
    };
  }

  // For Ed25519 we store deterministic compatibility bytes; callers only
  // require a stable persisted structure + DID, not P-256 coordinates.
  const x = publicKey.length >= 32 ? publicKey.slice(0, 32) : new Uint8Array(32);
  const y = new Uint8Array(32);
  return {
    algorithm: -8,
    x,
    y,
    keyType: 1,
    curve: 6
  };
}

export async function checkWebAuthnSupport() {
  if (!hasWebAuthn()) {
    return {
      supported: false,
      platformAuthenticator: false,
      message: 'WebAuthn is not supported in this browser'
    };
  }

  try {
    const platformAuthenticator =
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
        ? await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        : false;

    return {
      supported: true,
      platformAuthenticator,
      message: platformAuthenticator
        ? 'WebAuthn with platform authenticator is available'
        : 'WebAuthn is available'
    };
  } catch {
    return {
      supported: true,
      platformAuthenticator: false,
      message: 'WebAuthn is available'
    };
  }
}

export function storeWebAuthnCredential(credential: WebAuthnCredentialInfo, key?: string): void {
  storeWebAuthnCredentialSafe(credential, key || STORAGE_KEY);
}

export function loadWebAuthnCredential(key?: string): WebAuthnCredentialInfo | null {
  return loadWebAuthnCredentialSafe(key || STORAGE_KEY) as WebAuthnCredentialInfo | null;
}

export function clearWebAuthnCredential(key?: string): void {
  clearWebAuthnCredentialSafe(key || STORAGE_KEY);
}

export class WebAuthnDIDProvider {
  public did: string;
  public rawCredentialId: Uint8Array;

  constructor(credentialInfo: WebAuthnCredentialInfo) {
    this.did = credentialInfo.did || '';
    this.rawCredentialId = credentialInfo.rawCredentialId;
  }

  static isSupported(): boolean {
    return hasWebAuthn();
  }

  static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    if (!hasWebAuthn()) return false;
    if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    return window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }

  async authenticate(): Promise<unknown> {
    return navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: new Uint8Array(this.rawCredentialId), type: 'public-key' }],
        userVerification: 'required'
      }
    });
  }

  static async getOrCreateCredential(options: {
    userId?: string;
    displayName?: string;
    domain?: string;
    existingCredentialId?: string | null;
  } = {}): Promise<WebAuthnCredentialInfo> {
    const {
      userId = 'ucan-upload-wall-user',
      displayName = 'UCAN Upload Wall User',
      domain = window.location.hostname,
      existingCredentialId
    } = options;

    const stored = loadWebAuthnCredential();
    if (stored && (!existingCredentialId || stored.credentialId === existingCredentialId)) {
      return stored;
    }

    const signer = await createWebAuthnSigner({
      userId,
      displayName,
      domain,
      authenticatorType: 'any'
    });

    const rawCredentialId = signer.getCredentialId();
    const keyAlgorithm = signer.algorithm === 'P-256' ? 'P-256' : 'Ed25519';

    return {
      credentialId: bytesToBase64url(rawCredentialId),
      rawCredentialId,
      publicKey: toP256LikePublicKey(signer.publicKey),
      userId,
      displayName,
      did: signer.did,
      keyAlgorithm,
      isNativeEd25519: keyAlgorithm === 'Ed25519'
    };
  }

  static async extractPrfSeed(credentialInfo: WebAuthnCredentialInfo): Promise<Uint8Array> {
    const result = await extractPrfSeedFromCredential(credentialInfo, {
      rpId: window.location.hostname,
      prfInput: credentialInfo.prfInput
    });

    credentialInfo.prfSeed = result.seed;
    credentialInfo.prfSource = result.source;

    return result.seed;
  }
}
