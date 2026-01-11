/**
 * WebAuthn Varsig Decoder
 * 
 * Decodes varsig format back into WebAuthn assertion components
 */

import { varintDecode } from './utils.js';
import { WEBAUTHN_ED25519, WEBAUTHN_P256, getAlgorithm } from './multicodec.js';
import type { DecodedVarsig, ClientDataJSON } from './types.js';

/**
 * Decode a WebAuthn varsig into its components
 * 
 * Format:
 * - multicodec (varint)
 * - authenticatorData length (varint)
 * - authenticatorData (bytes)
 * - clientDataJSON length (varint)
 * - clientDataJSON (bytes)
 * - signature (64 bytes for Ed25519, 70-72 bytes for P-256)
 */
export function decodeWebAuthnVarsig(varsig: Uint8Array): DecodedVarsig {
  let offset = 0;

  // Read multicodec
  const [multicodec, multicodecLen] = varintDecode(varsig, offset);
  offset += multicodecLen;

  // Validate multicodec
  if (multicodec !== WEBAUTHN_ED25519 && multicodec !== WEBAUTHN_P256) {
    throw new Error(`Unsupported multicodec: 0x${multicodec.toString(16)}`);
  }

  const algorithm = getAlgorithm(multicodec);

  // Read authenticatorData
  const [authDataLen, authDataLenLen] = varintDecode(varsig, offset);
  offset += authDataLenLen;
  
  if (offset + authDataLen > varsig.length) {
    throw new Error('Invalid authenticatorData length');
  }
  
  const authenticatorData = varsig.slice(offset, offset + authDataLen);
  offset += authDataLen;

  // Read clientDataJSON
  const [clientDataLen, clientDataLenLen] = varintDecode(varsig, offset);
  offset += clientDataLenLen;
  
  if (offset + clientDataLen > varsig.length) {
    throw new Error('Invalid clientDataJSON length');
  }
  
  const clientDataJSON = varsig.slice(offset, offset + clientDataLen);
  offset += clientDataLen;

  // Read signature (rest of the bytes)
  const signature = varsig.slice(offset);
  
  // Validate signature length
  if (algorithm === 'Ed25519') {
    if (signature.length !== 64) {
      throw new Error(`Invalid Ed25519 signature length: expected 64 bytes, got ${signature.length}`);
    }
  } else if (algorithm === 'P-256') {
    // P-256 signatures are DER-encoded and vary in length (typically 70-72 bytes)
    if (signature.length < 64 || signature.length > 74) {
      throw new Error(`Invalid P-256 signature length: expected 64-74 bytes, got ${signature.length}`);
    }
  }

  return {
    multicodec,
    algorithm,
    authenticatorData,
    clientDataJSON,
    signature
  };
}

/**
 * Parse clientDataJSON bytes into structured data
 */
export function parseClientDataJSON(bytes: Uint8Array): ClientDataJSON {
  try {
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    
    return {
      type: parsed.type,
      challenge: parsed.challenge,
      origin: parsed.origin,
      crossOrigin: parsed.crossOrigin
    };
  } catch (error) {
    throw new Error(`Failed to parse clientDataJSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
