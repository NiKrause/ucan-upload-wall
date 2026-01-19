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
 * - signature (length depends on authenticator and algorithm)
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
  
  if (signature.length === 0) {
    throw new Error('Signature is empty');
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
