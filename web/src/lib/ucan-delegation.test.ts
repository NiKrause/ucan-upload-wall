// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UCANDelegationService } from './ucan-delegation';

let hardwareInitResult = true;
let hardwareDid = 'did:key:z6MkHardwareEd';
let hardwareAlgorithm: 'Ed25519' | 'P-256' = 'Ed25519';

const mockGenerateWorkerEd25519DID = vi.fn(async () => ({
  publicKey: new Uint8Array([1, 2, 3]),
  did: 'did:key:z6MkWorkerFallback',
  archive: { id: 'archive', keys: {} as Record<string, Uint8Array> },
}));

const mockInitKeystore = vi.fn(async () => {});

vi.mock('./hardware-ucan-service', () => ({
  HardwareUCANDelegationService: class {
    async initializeHardwareSigner() {
      return hardwareInitResult;
    }
    getHardwareDID() {
      return hardwareDid;
    }
    getHardwareAlgorithm() {
      return hardwareAlgorithm;
    }
  },
}));

vi.mock('./webauthn-ed25519-signer', () => ({
  checkEd25519Support: vi.fn(async () => true),
}));

vi.mock('./secure-ed25519-did', () => ({
  initEd25519KeystoreWithPrfSeed: mockInitKeystore,
  generateWorkerEd25519DID: mockGenerateWorkerEd25519DID,
  encryptArchive: vi.fn(async () => ({
    ciphertext: new Uint8Array([10, 11]),
    iv: new Uint8Array([12, 13]),
  })),
  decryptArchive: vi.fn(async () => ({ id: 'archive', keys: {} as Record<string, Uint8Array> })),
}));

vi.mock('./webauthn-did', () => {
  class MockWebAuthnDIDProvider {
    did: string;
    constructor(info: { did?: string } = {}) {
      this.did = info.did ?? 'did:key:z6MkMockWebAuthn';
    }
    static async getOrCreateCredential() {
      return {
        did: 'did:key:z6MkMockWebAuthn',
        rawCredentialId: new Uint8Array([1]),
        publicKey: { x: new Uint8Array([2]), y: new Uint8Array([3]) },
      };
    }
    static async extractPrfSeed() {
      return new Uint8Array([9, 9, 9]);
    }
    static isSupported() {
      return true;
    }
  }

  return {
    WebAuthnDIDProvider: MockWebAuthnDIDProvider,
    storeWebAuthnCredential: vi.fn(),
  };
});

describe('UCANDelegationService hardware fallback behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    hardwareInitResult = true;
    hardwareDid = 'did:key:z6MkHardwareEd';
    hardwareAlgorithm = 'Ed25519';
    mockGenerateWorkerEd25519DID.mockClear();
    mockInitKeystore.mockClear();
  });

  it('uses hardware Ed25519 when available', async () => {
    const service = new UCANDelegationService();
    const keypair = await service.initializeEd25519DID(false, 'platform');

    expect(keypair.did).toBe(hardwareDid);
    const mode = service.getSigningMode();
    expect(mode.mode).toBe('hardware');
    expect(mode.algorithm).toBe('Ed25519');
    expect(mockGenerateWorkerEd25519DID).not.toHaveBeenCalled();
  });

  it('falls back to hardware P-256 when Ed25519 is unavailable', async () => {
    hardwareAlgorithm = 'P-256';
    hardwareDid = 'did:key:zDnaHardwareP256';

    const service = new UCANDelegationService();
    const keypair = await service.initializeEd25519DID(false, 'platform');

    expect(keypair.did).toBe(hardwareDid);
    const mode = service.getSigningMode();
    expect(mode.mode).toBe('hardware');
    expect(mode.algorithm).toBe('P-256');
    expect(mockGenerateWorkerEd25519DID).not.toHaveBeenCalled();
  });

  it('falls back to worker mode when hardware initialization fails', async () => {
    hardwareInitResult = false;
    localStorage.setItem(
      'webauthn_credential_info',
      JSON.stringify({
        rawCredentialId: { 0: 1 },
        publicKey: { x: { 0: 1 }, y: { 0: 2 } },
        prfInput: { 0: 7 },
      })
    );

    const service = new UCANDelegationService();
    const keypair = await service.initializeEd25519DID(false, 'platform');

    expect(keypair.did).toBe('did:key:z6MkWorkerFallback');
    const mode = service.getSigningMode();
    expect(mode.mode).toBe('worker');
    expect(mockGenerateWorkerEd25519DID).toHaveBeenCalled();
    expect(mockInitKeystore).toHaveBeenCalled();
  });
});
