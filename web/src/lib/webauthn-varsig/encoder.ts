/**
 * WebAuthn Varsig Encoder
 * 
 * Encodes WebAuthn assertion data into varsig format:
 * [multicodec] + [authData_len] + [authData] + [clientData_len] + [clientData] + [signature]
 */

import { ALGORITHM_TO_MULTICODEC } from './multicodec.js';
import type { WebAuthnAssertion, SignatureAlgorithm } from './types.js';
import { varintEncode, concat } from './utils.js';

/**
 * Encode a WebAuthn assertion as varsig
 * 
 * @param assertion - WebAuthn assertion data
 * @param algorithm - Signature algorithm used ('Ed25519' or 'P-256')
 * @returns Uint8Array containing the varsig-encoded data
 */
export function encodeWebAuthnVarsig(
  assertion: WebAuthnAssertion,
  algorithm: SignatureAlgorithm = 'Ed25519'
): Uint8Array {
  const { authenticatorData, clientDataJSON, signature } = assertion;
  
  // Get multicodec for the algorithm
  const multicodec = ALGORITHM_TO_MULTICODEC[algorithm];
  const multicodecBytes = varintEncode(multicodec);
  
  // Encode lengths as varints
  const authDataLenBytes = varintEncode(authenticatorData.length);
  const clientDataLenBytes = varintEncode(clientDataJSON.length);
  
  // Concatenate all parts
  // Format: [multicodec][authData_len][authData][clientData_len][clientData][signature]
  const varsig = concat([
    multicodecBytes,
    authDataLenBytes,
    authenticatorData,
    clientDataLenBytes,
    clientDataJSON,
    signature
  ]);
  
  return varsig;
}

/**
 * Validate WebAuthn assertion data before encoding
 * 
 * @param assertion - WebAuthn assertion to validate
 * @throws Error if assertion is invalid
 */
export function validateWebAuthnAssertion(assertion: WebAuthnAssertion): void {
  if (!assertion.authenticatorData || assertion.authenticatorData.length === 0) {
    throw new Error('authenticatorData is required and cannot be empty');
  }
  
  if (!assertion.clientDataJSON || assertion.clientDataJSON.length === 0) {
    throw new Error('clientDataJSON is required and cannot be empty');
  }
  
  if (!assertion.signature || assertion.signature.length === 0) {
    throw new Error('signature is required and cannot be empty');
  }
  
  // Validate signature length based on algorithm
  // Ed25519 signatures are always 64 bytes
  // P-256 signatures are variable length (typically 70-72 bytes in DER format)
  if (assertion.signature.length < 64) {
    throw new Error(`Signature too short: ${assertion.signature.length} bytes`);
  }
}
