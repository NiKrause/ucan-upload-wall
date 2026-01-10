# WebAuthn Varsig

Hardware-backed UCAN signing using WebAuthn Ed25519 and P-256 credentials with varsig (variable signature) encoding.

## Overview

This module enables **hardware-backed UCAN signing** by encoding WebAuthn assertions into the varsig format. This eliminates the need for software-based key storage while maintaining compatibility with the UCAN ecosystem.

### Key Benefits

✅ **Hardware Security**: Private keys never leave secure hardware (TPM/Secure Enclave)  
✅ **Per-Operation Authentication**: Biometric verification required for each signature  
✅ **XSS Protection**: Keys cannot be extracted even with code injection  
✅ **No localStorage**: No encrypted keystores to protect  
✅ **UCAN Compatible**: Works with existing UCAN verification infrastructure

## Architecture

```
WebAuthn Credential → Sign with biometric → Varsig encoding → UCAN
       ↑                                            ↓
  Hardware Secure                        Custom verification layer
```

### Current Flow (Vulnerable)
```
WebAuthn → PRF Seed → AES Key → Ed25519 in Worker → Sign in JS
   ↑                                   ↑
Hardware                         Software (Extractable)
```

### New Flow (Hardware-Backed)
```
WebAuthn Ed25519 → Sign assertion → Encode varsig → Verify → UCAN
        ↑                                              ↑
  Hardware Secure                              Our verification
```

## Varsig Format

```
varsig = [multicodec] + [authData_len] + [authData] + [clientData_len] + [clientData] + [signature]
```

- **multicodec**: `0x2ed1` for WebAuthn Ed25519, `0x2256` for WebAuthn P-256
- **authData_len**: Varint-encoded length of authenticatorData
- **authData**: Raw authenticatorData from WebAuthn assertion
- **clientData_len**: Varint-encoded length of clientDataJSON
- **clientData**: Raw clientDataJSON from WebAuthn assertion
- **signature**: Raw signature (64 bytes for Ed25519, ~70 bytes for P-256)

## Usage

### Encoding

```typescript
import { encodeWebAuthnVarsig } from './lib/webauthn-varsig';

// Get WebAuthn assertion
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: ucanPayloadHash,
    allowCredentials: [{ id: credentialId }]
  }
});

const response = assertion.response as AuthenticatorAssertionResponse;

// Encode as varsig
const varsig = encodeWebAuthnVarsig({
  authenticatorData: new Uint8Array(response.authenticatorData),
  clientDataJSON: new Uint8Array(response.clientDataJSON),
  signature: new Uint8Array(response.signature)
}, 'Ed25519');
```

### Decoding

```typescript
import { decodeWebAuthnVarsig } from './lib/webauthn-varsig';

// Decode varsig
const decoded = decodeWebAuthnVarsig(varsig);

console.log('Algorithm:', decoded.multicodec === 0x2ed1 ? 'Ed25519' : 'P-256');
console.log('AuthenticatorData:', decoded.authenticatorData);
console.log('ClientDataJSON:', new TextDecoder().decode(decoded.clientDataJSON));
console.log('Signature:', decoded.signature);
```

### Verification

```typescript
import { 
  verifyWebAuthnAssertion, 
  reconstructSignedData,
  verifyEd25519Signature 
} from './lib/webauthn-varsig';

// 1. Verify WebAuthn assertion structure
const result = verifyWebAuthnAssertion(decoded, {
  expectedOrigin: 'https://your-app.com',
  expectedChallenge: ucanPayloadHash,
  requireUserVerification: true
});

if (!result.valid) {
  throw new Error(result.error);
}

// 2. Reconstruct signed data
const signedData = await reconstructSignedData(decoded);

// 3. Verify cryptographic signature
const isValid = await verifyEd25519Signature(
  signedData,
  decoded.signature,
  publicKey
);
```

## Testing

### Unit Tests

```bash
npm test
```

All tests use mock WebAuthn data and don't require real credentials:

```typescript
import { createMockEd25519Assertion } from './lib/webauthn-varsig/test-utils';

const mockAssertion = createMockEd25519Assertion({
  challenge: 'test-challenge',
  origin: 'https://test.example.com'
});
```

### Test Coverage

- ✅ Varint encoding/decoding
- ✅ Varsig encoding/decoding
- ✅ Ed25519 and P-256 support
- ✅ Round-trip integrity
- ✅ Error handling
- ✅ ClientDataJSON parsing
- ✅ Mock data generation

## Browser Support

| Browser | Ed25519 | P-256 | Status |
|---------|---------|-------|--------|
| Chrome/Edge 108+ | ✅ | ✅ | Full support |
| Safari 17+ (macOS 14+/iOS 17+) | ✅ | ✅ | Full support |
| Firefox | ⚠️ | ✅ | Platform dependent |

## API Reference

### Encoder

- `encodeWebAuthnVarsig(assertion, algorithm)` - Encode WebAuthn assertion as varsig
- `validateWebAuthnAssertion(assertion)` - Validate assertion before encoding

### Decoder

- `decodeWebAuthnVarsig(varsig)` - Decode varsig into components
- `parseClientDataJSON(bytes)` - Parse clientDataJSON bytes

### Verifier

- `verifyWebAuthnAssertion(decoded, options)` - Verify assertion structure
- `reconstructSignedData(decoded)` - Reconstruct what was signed
- `verifyEd25519Signature(data, signature, publicKey)` - Verify Ed25519 signature
- `verifyP256Signature(data, signature, publicKey)` - Verify P-256 signature

### Utilities

- `varintEncode(number)` / `varintDecode(bytes)` - Varint encoding
- `bytesToBase64url(bytes)` / `base64urlToBytes(string)` - Base64url conversion
- `concat(arrays)` - Concatenate Uint8Arrays
- `bytesEqual(a, b)` - Compare arrays

### Test Utilities

- `createMockEd25519Assertion(options)` - Generate mock Ed25519 assertion
- `createMockP256Assertion(options)` - Generate mock P-256 assertion
- `createMockAuthenticatorData(options)` - Generate mock authenticatorData
- `createMockClientDataJSON(options)` - Generate mock clientDataJSON

## Security

### What This Solves

| Threat | Current (Worker) | WebAuthn Varsig |
|--------|-----------------|-----------------|
| XSS key extraction | ❌ Vulnerable | ✅ Impossible |
| localStorage attack | ❌ Keys stored | ✅ No keys |
| Memory dumping | ❌ Keys in memory | ✅ Hardware only |
| Code injection | ❌ Can steal keys | ✅ Cannot extract |

### Limitations

- Origin-bound signatures (tied to web origin)
- Requires biometric for every signature (better security, slight UX impact)
- Larger payload than raw signatures (~200-300 bytes vs 64 bytes)
- Requires custom verification logic (not yet in ucanto/Storacha)

## Integration with UCAN

### Creating UCANs

```typescript
// 1. Create UCAN payload
const payload = {
  iss: 'did:key:z6Mk...',
  aud: 'did:web:up.storacha.network',
  att: [{ with: spaceDid, can: 'upload/add' }],
  exp: Date.now() + 86400
};

// 2. Sign with WebAuthn
const payloadBytes = encodeUcanPayload(payload);
const challenge = await crypto.subtle.digest('SHA-256', payloadBytes);

const assertion = await navigator.credentials.get({
  publicKey: { challenge }
});

// 3. Encode as varsig
const varsig = encodeWebAuthnVarsig({
  authenticatorData: new Uint8Array(assertion.response.authenticatorData),
  clientDataJSON: new Uint8Array(assertion.response.clientDataJSON),
  signature: new Uint8Array(assertion.response.signature)
}, 'Ed25519');

// 4. Create signed UCAN
const signedUcan = {
  ...payload,
  sig: varsig
};
```

### Verifying UCANs

```typescript
// 1. Decode varsig
const decoded = decodeWebAuthnVarsig(ucan.sig);

// 2. Verify structure
const result = verifyWebAuthnAssertion(decoded, {
  expectedOrigin: 'https://your-app.com',
  expectedChallenge: sha256(ucan.payload)
});

// 3. Verify signature
const signedData = await reconstructSignedData(decoded);
const isValid = await verifyEd25519Signature(
  signedData,
  decoded.signature,
  extractPublicKeyFromDid(ucan.iss)
);
```

## Next Steps

1. ✅ Core implementation (completed)
2. ✅ Unit tests (completed)
3. ⏳ Integration with UCANDelegationService
4. ⏳ WebAuthn credential creation flow
5. ⏳ E2E tests with real WebAuthn
6. ⏳ P-256 support
7. ⏳ Documentation and examples

## References

- [WebAuthn Level 3 Specification](https://www.w3.org/TR/webauthn-3/)
- [Varsig Specification](https://github.com/multiformats/multicodec)
- [UCAN Specification](https://github.com/ucan-wg/spec)
- [Security Analysis](../../../SECURITY.md)
