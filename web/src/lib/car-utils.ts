/**
 * CAR (Content Addressable aRchive) Utilities
 * 
 * CAR files are used to package IPLD data with CIDs (Content Identifiers).
 * In the context of UCAN delegations, we:
 * 1. Take a delegation token (base64 encoded)
 * 2. Convert it to bytes
 * 3. Create a CID for those bytes
 * 4. Package it into a CAR file format
 * 
 * This allows the delegation to be stored and retrieved from IPFS/Storacha.
 */

import { CarWriter, CarReader } from '@ipld/car';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';

/**
 * Convert base64 string to Uint8Array
 * Handles both standard base64 and URL-safe base64
 */
export function base64ToBytes(b64: string): Uint8Array {
  // Remove any whitespace
  const cleaned = b64.replace(/\s/g, '');
  
  // Handle URL-safe base64 (replace - with + and _ with /)
  const standard = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  
  return Uint8Array.from(atob(standard), c => c.charCodeAt(0));
}

/**
 * Convert Uint8Array to base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a UCAN delegation token to CAR file bytes
 * 
 * Process:
 * 1. Decode the token from base64 (handling multibase 'm' prefix)
 * 2. Hash the bytes using SHA-256
 * 3. Create a CID (Content Identifier) using the hash
 * 4. Create a CAR writer with the CID as root
 * 5. Write the bytes as a block
 * 6. Return the complete CAR file as bytes
 * 
 * @param token - Base64 encoded delegation token (may have 'm' prefix for multibase)
 * @returns CAR file as Uint8Array
 */
export async function tokenToCarBytes(token: string): Promise<Uint8Array> {
  // Step 1: Decode token - handle multibase 'm' prefix
  let bytes: Uint8Array;
  if (token.startsWith('m')) {
    // Multibase format: 'm' prefix indicates base64
    const base64Part = token.substring(1);
    bytes = base64ToBytes(base64Part);
  } else if (token.startsWith('u')) {
    // Multibase format: 'u' prefix indicates base64url
    const base64Part = token.substring(1);
    bytes = base64ToBytes(base64Part);
  } else {
    // Fallback: treat as raw base64
    bytes = base64ToBytes(token);
  }
  
  // Step 2: Create hash of the bytes
  const hash = await sha256.digest(bytes);
  
  // Step 3: Create CID (Content Identifier)
  // Version 1, raw codec, SHA-256 hash
  const cid = CID.create(1, raw.code, hash);
  
  // Step 4: Create CAR writer with CID as root
  const { writer, out } = await CarWriter.create([cid]);
  
  // Step 5: Collect output chunks
  // IMPORTANT: Start consuming output BEFORE writing blocks to avoid deadlock
  const chunks: Uint8Array[] = [];
  const collectPromise = (async () => {
    for await (const chunk of out) {
      chunks.push(chunk);
    }
  })();
  
  // Step 6: Write the block
  await writer.put({
    cid,
    bytes
  });
  
  // Step 7: Close writer
  await writer.close();
  
  // Step 8: Wait for all chunks to be collected
  await collectPromise;
  
  // Step 9: Combine chunks into single Uint8Array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

/**
 * Parse a CAR file and extract the delegation token
 * 
 * This is the reverse of tokenToCarBytes:
 * 1. Parse the CAR file
 * 2. Extract the root block
 * 3. Convert bytes back to base64
 * 4. Add multibase 'm' prefix
 * 
 * @param carBytes - CAR file as Uint8Array
 * @returns Original delegation token with 'm' prefix
 */
export async function carBytesToToken(carBytes: Uint8Array): Promise<string> {
  // Step 1: Create CAR reader
  const reader = await CarReader.fromBytes(carBytes);
  
  // Step 2: Get root CIDs
  const roots = await reader.getRoots();
  if (roots.length === 0) {
    throw new Error('CAR file has no roots');
  }
  
  const rootCID = roots[0];
  
  // Step 3: Get the block for the root CID
  const block = await reader.get(rootCID);
  if (!block) {
    throw new Error('Root block not found in CAR file');
  }
  
  // Step 4: Convert bytes to base64 and add multibase prefix
  const base64 = bytesToBase64(block.bytes);
  const token = 'm' + base64;
  
  return token;
}

/**
 * Create a CAR file (as File object) from a delegation token
 * 
 * @param token - Delegation token
 * @param targetDID - Target DID (for filename)
 * @returns File object ready for upload
 */
export async function createCarFile(token: string, targetDID: string): Promise<File> {
  const carBytes = await tokenToCarBytes(token);
  
  // Create filename with targetDID and unix timestamp
  const unixTimestamp = Math.floor(Date.now() / 1000);
  const filename = `${targetDID}-${unixTimestamp}.car`;
  
  const carBlob = new Blob([carBytes], {
    type: 'application/vnd.ipld.car'
  });
  
  const carFile = new File([carBlob], filename, {
    type: 'application/vnd.ipld.car'
  });
  
  return carFile;
}

/**
 * Parse a CAR File object and extract the delegation token
 * 
 * @param file - CAR File object
 * @returns Delegation token
 */
export async function parseCarFile(file: File): Promise<string> {
  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  const carBytes = new Uint8Array(arrayBuffer);
  
  // Parse CAR bytes
  const token = await carBytesToToken(carBytes);
  
  return token;
}

/**
 * Validate if bytes are a valid CAR file
 * 
 * @param bytes - Bytes to validate
 * @returns true if valid CAR file
 */
export async function isValidCarFile(bytes: Uint8Array): Promise<boolean> {
  try {
    const reader = await CarReader.fromBytes(bytes);
    const roots = await reader.getRoots();
    return roots.length > 0;
  } catch (error) {
    console.error('Error validating CAR file:', error);
    return false;
  }
}

/**
 * Get information about a CAR file
 * 
 * @param bytes - CAR file bytes
 * @returns Information about the CAR file
 */
export async function getCarFileInfo(bytes: Uint8Array): Promise<{
  roots: string[];
  blockCount: number;
  totalSize: number;
}> {
  const reader = await CarReader.fromBytes(bytes);
  const roots = await reader.getRoots();
  
  let blockCount = 0;
  let totalSize = 0;
  
  for await (const block of reader.blocks()) {
    blockCount++;
    totalSize += block.bytes.length;
  }
  
  return {
    roots: roots.map(cid => cid.toString()),
    blockCount,
    totalSize
  };
}
