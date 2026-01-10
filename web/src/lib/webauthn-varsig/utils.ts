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
  
  // Encode to base64
  const base64 = btoa(binaryString);
  
  // Convert to base64url
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Compare two Uint8Arrays for equality
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  
  return true;
}
