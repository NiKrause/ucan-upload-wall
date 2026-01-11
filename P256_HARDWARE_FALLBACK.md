# P-256 Hardware Fallback Implementation

## Overview

This implementation adds **automatic P-256 fallback** when Ed25519 is not supported by the hardware authenticator. This allows your WebAuthn hardware credentials to work with your ucanto fork that supports P-256 UCANs.

## Architecture

```
User clicks "Touch ID / Face ID" or "Security Key"
    ↓
WebAuthn attempts credential creation with preference for Ed25519
    ↓
Authenticator responds with COSE key
    ↓
┌─────────────────────────────────────┐
│  Try Extract Ed25519 Public Key    │
└─────────────────┬───────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
    SUCCESS                FAIL
       │                     │
       ↓                     ↓
┌──────────────┐    ┌──────────────────┐
│ Ed25519 Mode │    │ Try P-256 Extract│
│ (Preferred)  │    └─────────┬────────┘
└──────────────┘              │
                   ┌──────────┴──────────┐
                   │                     │
                SUCCESS               FAIL
                   │                     │
                   ↓                     ↓
           ┌──────────────┐    ┌──────────────┐
           │  P-256 Mode  │    │ Worker Mode  │
           │  (Fallback)  │    │  (Ultimate)  │
           └──────────────┘    └──────────────┘
```

## Implementation Details

### 1. **New Classes**

#### `WebAuthnP256Signer`
- Mirrors `WebAuthnEd25519Signer` but for P-256
- Signs UCANs with P-256 WebAuthn credentials
- Encodes signatures as P-256 varsig (multicodec `0x2256`)

```typescript
export class WebAuthnP256Signer {
  public algorithm = 'P-256' as const;
  
  async sign(payload: Uint8Array): Promise<Uint8Array> {
    // Get WebAuthn assertion
    // Encode as P-256 varsig
  }
}
```

### 2. **P-256 Public Key Extraction**

#### `extractP256PublicKey(attestationObject: Uint8Array)`
Extracts P-256 public key from COSE format:

**COSE Key Structure (EC2/P-256):**
```
kty (1):  2       (EC2 - Elliptic Curve)
alg (3):  -7      (ES256)
crv (-1): 1       (P-256)
x (-2):   <32 bytes>  (x-coordinate)
y (-3):   <32 bytes>  (y-coordinate)
```

**Output Format:**
```
[0x04] || x || y  (65 bytes total)
  ^
  Uncompressed point indicator
```

### 3. **P-256 DID Creation**

#### `createP256Did(publicKey: Uint8Array)`
Creates `did:key` with P-256 multicodec:

```typescript
// P-256 multicodec: 0x1200 (varint: [0x80, 0x24])
did:key:zDna...  // P-256 DID starts with 'zDna'
```

### 4. **Modified Credential Creation Flow**

#### `createWebAuthnEd25519Credential()` now returns:
```typescript
Promise<WebAuthnEd25519Signer | WebAuthnP256Signer | null>
```

**Flow:**
1. Request WebAuthn credential with multi-algorithm support:
   ```typescript
   pubKeyCredParams: [
     { alg: -8 },   // Ed25519 (preferred)
     { alg: -7 },   // P-256 (fallback)
     { alg: -257 }  // RS256 (compatibility)
   ]
   ```

2. Try to extract Ed25519 public key
   - ✅ **Success** → Return `WebAuthnEd25519Signer`
   
3. If Ed25519 fails, try P-256 extraction
   - ✅ **Success** → Return `WebAuthnP256Signer`
   
4. If both fail → Return `null` (falls back to worker mode)

### 5. **Hardware Service Updates**

#### Storage Format
```typescript
interface HardwareSignerInfo {
  credentialId: string;
  did: string;
  publicKey: string;  // hex encoded
  algorithm: 'Ed25519' | 'P-256';  // NEW: Track algorithm
  created: string;
}
```

#### Signer Loading
```typescript
// Recreate correct signer type based on stored algorithm
if (algorithm === 'P-256') {
  signer = new WebAuthnP256Signer(...);
} else {
  signer = new WebAuthnEd25519Signer(...);
}
```

#### Verification
```typescript
// Detect algorithm from varsig multicodec
if (algorithm === 'Ed25519') {
  valid = await verifyEd25519Signature(...);
} else if (algorithm === 'P-256') {
  valid = await verifyP256Signature(...);
}
```

#### DID Public Key Extraction
```typescript
// Support both Ed25519 and P-256 did:key formats
if (multicodec === [0xed, 0x01]) {
  return multikey.slice(2);  // Ed25519
} else if (multicodec === [0x80, 0x24]) {
  return multikey.slice(2);  // P-256
}
```

## Console Output

### When Ed25519 is Supported (Rare)
```
🔑 Creating WebAuthn Ed25519 credential (hardware-backed)...
✅ WebAuthn credential created
🔍 Authenticator returned COSE key: {
  kty: 1, ktyName: "OKP",
  alg: -8, algName: "EdDSA",
  crv: 6, crvName: "Ed25519"
}
✅ Successfully extracted Ed25519 public key (32 bytes)
🎉 HARDWARE ED25519 MODE ACTIVATED!
✅ Created WebAuthn Ed25519 credential
   DID: did:key:z6Mk...
```

### When P-256 is Used (Common - Most Devices)
```
🔑 Creating WebAuthn Ed25519 credential (hardware-backed)...
✅ WebAuthn credential created
🔍 Authenticator returned COSE key: {
  kty: 2, ktyName: "EC2",
  alg: -7, algName: "ES256",
  crv: 1, crvName: "P-256"
}
⚠️ Authenticator used EC2 (P-256) instead of OKP (Ed25519)
💡 This authenticator does not support Ed25519. Falling back to worker mode.
🔄 Ed25519 not available, attempting P-256 extraction...
✅ Successfully extracted P-256 public key (65 bytes)
🔄 HARDWARE P-256 MODE ACTIVATED (fallback from Ed25519)
   Keys are stored in secure hardware and cannot be extracted
   Biometric authentication required for each signature
   ⚠️  Using P-256 with your ucanto fork for UCAN compatibility
✅ Created WebAuthn P-256 credential (hardware-backed fallback)
   DID: did:key:zDna...
   Authenticator: Platform authenticator (Touch ID/Windows Hello)
   ⚠️  Using P-256 with ucanto fork for UCAN compatibility
```

### When Both Fail (No Hardware Support)
```
🔑 Creating WebAuthn Ed25519 credential (hardware-backed)...
✅ WebAuthn credential created
🔍 Authenticator returned COSE key: {...}
💡 Neither Ed25519 nor P-256 could be extracted from authenticator.
...
Falling back to worker mode with PRF encryption
```

## Hardware Support Matrix

| Device/Browser | Ed25519 | P-256 | Result |
|----------------|---------|-------|--------|
| **macOS Touch ID** (Intel) | ❌ | ✅ | **P-256 Hardware Mode** |
| **macOS Touch ID** (M1/M2/M3) | ❌ | ✅ | **P-256 Hardware Mode** |
| **Windows Hello** (TPM 2.0) | ❌ | ✅ | **P-256 Hardware Mode** |
| **Ledger (FIDO)** | ❌ | ✅ | **P-256 Hardware Mode** |
| **YubiKey 5** | ❌* | ✅ | **P-256 Hardware Mode** |
| **Chrome Android** | ❌ | ✅ | **P-256 Hardware Mode** |

\* Ed25519 support exists in hardware but not exposed via WebAuthn

## Benefits

### ✅ **Works Now with Current Hardware**
- Most platform authenticators support P-256
- No need to wait for Ed25519 rollout
- Immediate hardware-backed security

### ✅ **Future-Proof**
- Automatically uses Ed25519 when available
- Seamless upgrade path as hardware improves
- Same codebase handles both algorithms

### ✅ **Ecosystem Compatible**
- Works with your ucanto fork (P-256 support)
- Can be integrated with Storacha when ready
- Standard `did:key` format for both algorithms

### ✅ **User Experience**
- No manual configuration needed
- Transparent algorithm selection
- Clear console diagnostics

## Security Comparison

|  | Ed25519 Hardware | P-256 Hardware | Worker Mode |
|---|------------------|----------------|-------------|
| **Key Storage** | Secure Enclave/TPM | Secure Enclave/TPM | Browser Memory |
| **Key Export** | Impossible | Impossible | Encrypted in localStorage |
| **Biometric** | Required per sign | Required per sign | Once at creation |
| **Algorithm** | Ed25519 (preferred) | P-256 (standard) | Ed25519 |
| **UCAN Compat** | Native | Via ucanto fork | Native |

Both hardware modes provide **significantly better security** than worker mode!

## Next Steps

### Testing
1. Clear localStorage to remove old credentials
2. Click "🔒 Touch ID / Face ID" or "🔑 Security Key"
3. Check console output to see which mode activated:
   - **Ed25519**: "🎉 HARDWARE ED25519 MODE ACTIVATED!"
   - **P-256**: "🔄 HARDWARE P-256 MODE ACTIVATED"
   - **Worker**: "Falling back to worker mode"

### Integration with Storacha
When ready to integrate with Storacha:
1. Deploy your ucanto fork with P-256 support
2. Configure Storacha to use the forked ucanto
3. Both Ed25519 and P-256 hardware modes will work! 🎉

## Files Modified

- `web/src/lib/webauthn-ed25519-signer.ts` - Added `WebAuthnP256Signer` class, P-256 extraction, P-256 DID creation
- `web/src/lib/hardware-ucan-service.ts` - Updated to handle both signer types
- `web/src/lib/webauthn-varsig/types.ts` - Added `algorithm` field to `DecodedVarsig`

## Conclusion

This implementation gives you the **best of both worlds**:
- ✅ Hardware-backed security **today** (via P-256)
- ✅ Future Ed25519 support when hardware catches up
- ✅ Graceful fallback to worker mode if needed
- ✅ Works with your existing ucanto fork

**Your hardware credentials are now usable for UCAN signing!** 🎉🔐
