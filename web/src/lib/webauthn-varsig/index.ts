/**
 * WebAuthn Varsig - Public API
 * 
 * Main entry point for WebAuthn varsig encoding/decoding
 */

// Types
export type {
  WebAuthnAssertion,
  DecodedVarsig,
  ClientDataJSON,
  SignatureAlgorithm,
  VarsigOptions
} from './types.js';

// Multicodec constants
export {
  WEBAUTHN_ED25519,
  WEBAUTHN_P256,
  ED25519_PUB,
  P256_PUB,
  isWebAuthnMulticodec,
  getAlgorithm
} from './multicodec.js';

// Encoder
export {
  encodeWebAuthnVarsig,
  validateWebAuthnAssertion
} from './encoder.js';

// Decoder
export {
  decodeWebAuthnVarsig,
  parseClientDataJSON
} from './decoder.js';

// Verifier
export type {
  VerificationOptions,
  VerificationResult
} from './verifier.js';
export {
  verifyWebAuthnAssertion,
  reconstructSignedData,
  verifyEd25519Signature,
  verifyP256Signature
} from './verifier.js';

// Utilities
export {
  varintEncode,
  varintDecode,
  concat,
  base64urlToBytes,
  bytesToBase64url,
  bytesEqual
} from './utils.js';
