/**
 * WebAuthn Varsig - Public API
 * 
 * Main entry point for WebAuthn varsig encoding/decoding
 */

// Types
export type {
  WebAuthnAssertion,
  DecodedVarsigV1,
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
  VARSIG_PREFIX,
  VARSIG_VERSION,
  INNER_EDDSA,
  INNER_ECDSA,
  CURVE_ED25519,
  CURVE_P256,
  MULTIHASH_SHA256,
  MULTIHASH_SHA256_LEN,
  PAYLOAD_ENCODING_RAW,
  WEBAUTHN_WRAPPER,
  isWebAuthnMulticodec,
  getAlgorithm
} from './multicodec.js';

// Encoder
export {
  encodeWebAuthnVarsigV1,
  validateWebAuthnAssertion
} from './encoder.js';

// Decoder
export {
  decodeWebAuthnVarsigV1,
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
