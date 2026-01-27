import { base64 } from 'multiformats/bases/base64';

export interface SigningRequest {
  requestId: string;
  timestamp: string;
  data: string; // Base64 encoded Uint8Array
  requesterDID: string;
  pwaUrl: string;
  p2pAddress: string;
  expiresAt: string;
}

export interface SigningResponse {
  requestId: string;
  signature: string; // Base64 encoded signature
  approverDID: string;
}

export function encodeSigningRequest(request: SigningRequest): string {
  return JSON.stringify(request);
}

export function decodeSigningRequest(data: string): SigningRequest {
  return JSON.parse(data);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

export function base64ToUint8Array(str: string): Uint8Array {
  return base64.decode(str);
}
