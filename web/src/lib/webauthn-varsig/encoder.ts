/**
 * WebAuthn Varsig Encoder
 * 
 * Encodes WebAuthn assertion data into varsig format:
 * [multicodec] + [authData_len] + [authData] + [clientData_len] + [clientData] + [signature]
 */

import {
  ALGORITHM_TO_MULTICODEC,
  VARSIG_PREFIX,
  VARSIG_VERSION,
  INNER_EDDSA,
  INNER_ECDSA,
  CURVE_ED25519,
  CURVE_P256,
  MULTIHASH_SHA256,
  MULTIHASH_SHA256_LEN,
  PAYLOAD_ENCODING_RAW,
  WEBAUTHN_WRAPPER
} from './multicodec.js';
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
 * Encode a WebAuthn assertion as varsig v1
 *
 * Format:
 * - varsig prefix (0x34)
 * - varsig version (0x01)
 * - signature algorithm metadata (varints)
 * - payload encoding metadata (varint)
 * - assertion serialization
 */
export function encodeWebAuthnVarsigV1(
  assertion: WebAuthnAssertion,
  algorithm: SignatureAlgorithm = 'Ed25519'
): Uint8Array {
  const { authenticatorData, clientDataJSON, signature } = assertion;

  validateWebAuthnAssertion(assertion);

  const innerAlgorithm = algorithm === 'Ed25519' ? INNER_EDDSA : INNER_ECDSA;
  const curve = algorithm === 'Ed25519' ? CURVE_ED25519 : CURVE_P256;

  const header = new Uint8Array([VARSIG_PREFIX, VARSIG_VERSION]);
  const authDataLenBytes = varintEncode(authenticatorData.length);
  const clientDataLenBytes = varintEncode(clientDataJSON.length);

  return concat([
    header,
    varintEncode(innerAlgorithm),
    varintEncode(curve),
    varintEncode(MULTIHASH_SHA256),
    varintEncode(MULTIHASH_SHA256_LEN),
    varintEncode(WEBAUTHN_WRAPPER),
    varintEncode(PAYLOAD_ENCODING_RAW),
    authDataLenBytes,
    authenticatorData,
    clientDataLenBytes,
    clientDataJSON,
    signature
  ]);
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
  
  // WebAuthn signature length depends on the authenticator and algorithm.
  if (assertion.signature.length === 0) {
    throw new Error('signature is required and cannot be empty');
  }
}
