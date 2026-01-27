/**
 * Utility functions for varsig encoding/decoding
 */

/**
 * Encode a number as unsigned varint (variable-length integer)
 * Uses LEB128 encoding (Little Endian Base 128)
 * 
 * @param value - The number to encode
 * @returns Uint8Array containing the varint encoding
 */
export function varintEncode(value: number): Uint8Array {
  const bytes: number[] = [];
  
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  
  return new Uint8Array(bytes);
}

/**
 * Decode unsigned varint from bytes
 * 
 * @param bytes - The bytes to decode from
 * @param offset - Starting offset in the bytes
 * @returns [value, bytesRead] - The decoded value and number of bytes consumed
 */
export function varintDecode(bytes: Uint8Array, offset = 0): [number, number] {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  
  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead];
    bytesRead++;
    
    value |= (byte & 0x7f) << shift;
    
    if ((byte & 0x80) === 0) {
      return [value, bytesRead];
    }
    
    shift += 7;
    
    if (shift > 53) {
      throw new Error('Varint too large (exceeds JavaScript number precision)');
    }
  }
  
  throw new Error('Varint incomplete');
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concat(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
}

/**
 * Convert base64url to Uint8Array
 */
export function base64urlToBytes(base64url: string): Uint8Array {
  // Convert base64url to base64
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  // Add padding if needed
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const paddedBase64 = base64 + padding;
  
  // Decode base64
  const binaryString = atob(paddedBase64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

/**
 * Convert Uint8Array to base64url
 */
export function bytesToBase64url(bytes: Uint8Array): string {
  // Convert to binary string
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  
  // Convert to base64
  const base64 = btoa(binaryString);
  
  // Convert to base64url
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Compare two Uint8Arrays for equality
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  
  return true;
}

/**
 * Convert DER-encoded ECDSA signature (ASN.1) to Raw format (r|s)
 * 
 * @param signature - DER-encoded signature
 * @param curveBits - Bit length of the curve (256 for P-256)
 * @returns Raw signature (r|s concatenated)
 */
export function convertAsn1ToRaw(signature: Uint8Array, curveBits: number): Uint8Array {
  // ASN.1 SEQUENCE: 0x30 [length]
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error('Invalid ASN.1 signature: missing SEQUENCE');
  
  let length = signature[offset++];
  if (length & 0x80) { // Long form length
    const lenBytes = length & 0x7f;
    offset += lenBytes;
  }
  
  // INTEGER r: 0x02 [length] [bytes]
  if (signature[offset++] !== 0x02) throw new Error('Invalid ASN.1 signature: missing INTEGER r');
  let rLen = signature[offset++];
  let rStart = offset;
  offset += rLen;
  
  // INTEGER s: 0x02 [length] [bytes]
  if (signature[offset++] !== 0x02) throw new Error('Invalid ASN.1 signature: missing INTEGER s');
  let sLen = signature[offset++];
  let sStart = offset;
  
  const byteLen = Math.ceil(curveBits / 8);
  const raw = new Uint8Array(byteLen * 2);
  
  // Copy r (remove leading zeros if needed, or pad)
  let rBytes = signature.slice(rStart, rStart + rLen);
  // ASN.1 INTEGERs are signed, so they might have a leading 0x00 to make it positive
  while (rBytes.length > byteLen && rBytes[0] === 0) {
    rBytes = rBytes.slice(1);
  }
  // If still too long, it's invalid
  if (rBytes.length > byteLen) throw new Error('Invalid ASN.1 signature: r too long');
  // Copy to raw array with padding
  raw.set(rBytes, byteLen - rBytes.length);
  
  // Copy s
  let sBytes = signature.slice(sStart, sStart + sLen);
  while (sBytes.length > byteLen && sBytes[0] === 0) {
    sBytes = sBytes.slice(1);
  }
  if (sBytes.length > byteLen) throw new Error('Invalid ASN.1 signature: s too long');
  raw.set(sBytes, (byteLen * 2) - sBytes.length);
  
  return raw;
}
