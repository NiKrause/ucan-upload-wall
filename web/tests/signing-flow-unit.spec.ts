import { test, expect } from '@playwright/test';
import { 
  encodeSigningRequest, 
  decodeSigningRequest, 
  uint8ArrayToBase64, 
  base64ToUint8Array,
  SigningRequest 
} from '../src/lib/signing-flow';

test.describe('Signing Flow Logic', () => {
  test('should correctly encode and decode a signing request', () => {
    const data = new TextEncoder().encode('Hello World');
    const request: SigningRequest = {
      requestId: '123-456',
      timestamp: new Date().toISOString(),
      data: uint8ArrayToBase64(data),
      requesterDID: 'did:key:z123',
      pwaUrl: 'https://example.com',
      p2pAddress: 'peer-id-123',
      expiresAt: new Date(Date.now() + 3600).toISOString()
    };

    const encoded = encodeSigningRequest(request);
    const decoded = decodeSigningRequest(encoded);

    expect(decoded).toEqual(request);
    expect(base64ToUint8Array(decoded.data)).toEqual(data);
  });

  test('should handle base64 conversion correctly', () => {
    const original = new Uint8Array([1, 2, 3, 255]);
    const b64 = uint8ArrayToBase64(original);
    const roundtrip = base64ToUint8Array(b64);

    expect(roundtrip).toEqual(original);
  });
});
