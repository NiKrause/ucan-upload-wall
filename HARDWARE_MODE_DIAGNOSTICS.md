# Hardware Mode Diagnostics and Browser Compatibility

## Summary

Enhanced WebAuthn Ed25519 credential creation with comprehensive diagnostics to help users understand why hardware-backed mode may not be available on their device.

## What Changed

### 1. Multi-Algorithm Support

**Before:**
```typescript
pubKeyCredParams: [
  { type: 'public-key', alg: -8 }  // EdDSA only
]
```

**After:**
```typescript
pubKeyCredParams: [
  { type: 'public-key', alg: -8 },   // EdDSA (Ed25519) - PREFERRED
  { type: 'public-key', alg: -7 },   // ES256 (P-256) - fallback
  { type: 'public-key', alg: -257 }  // RS256 (RSA) - broad compatibility
]
```

**Why:** Chrome recommends including ES256 and RS256 to prevent registration failures on incompatible authenticators. Without fallbacks, some authenticators immediately reject with `NotAllowedError`.

### 2. Detailed COSE Key Diagnostics

When an authenticator creates a credential, the system now logs exactly what algorithm was used:

```javascript
🔍 Authenticator returned COSE key: {
  kty: 2,
  ktyName: 'EC2',
  alg: -7,
  algName: 'ES256',
  crv: 1,
  crvName: 'P-256'
}
⚠️ Authenticator used EC2 (P-256) instead of OKP (Ed25519)
💡 This authenticator does not support Ed25519. Falling back to worker mode.
```

### 3. Browser/Device Compatibility Information

When Ed25519 is not available, users see:

```
💡 Authenticator does not support Ed25519. This is expected on most devices.
   Supported browsers/devices:
   • Chrome 108+ on Windows 11 22H2+ (TPM 2.0)
   • Safari 17+ on macOS 14+ / iOS 17+ (Secure Enclave)
   • Edge 108+ on Windows 11 22H2+ (TPM 2.0)
   Worker mode (with PRF encryption) will be used instead.
```

### 4. Better Error Categorization

The system now distinguishes between:
- **User cancellation** (`NotAllowedError`)
- **Expected Ed25519 validation failures** (authenticator used different algorithm)
- **Unexpected errors** (actual bugs)

## Browser Testing Results

### DuckDuckGo Browser (macOS)
- ✅ WebAuthn credential creation succeeds
- ✅ PRF extension works perfectly
- ❌ Ed25519 not supported (uses P-256 instead)
- ✅ Diagnostic logs show: `ktyName: 'EC2'`, `algName: 'ES256'`, `crvName: 'P-256'`
- ✅ Graceful fallback to worker mode
- ✅ **PRF source: "prf"** (better than Brave)

### Brave Browser (macOS)
- ❌ WebAuthn credential creation with Ed25519-only rejected (`NotAllowedError`)
- ✅ With multi-algorithm support, should now attempt creation
- ❌ PRF extension not available (uses `credentialId` fallback)
- ✅ Worker mode with credentialId-based encryption works

### Expected Behavior (Chrome 108+ / Safari 17+)
- ✅ WebAuthn credential creation succeeds
- ✅ Ed25519 native support
- ✅ Diagnostic logs show: `ktyName: 'OKP'`, `algName: 'EdDSA'`, `crvName: 'Ed25519'`
- ✅ **Hardware mode activated** 🎉
- 🔒 Keys stored in TPM/Secure Enclave
- 🔐 Biometric required for each signature

## Why Ed25519 Support is Limited

### Hardware Requirements

**Ed25519 (OKP) in WebAuthn requires:**
- Modern TPM 2.0 (Windows) or Secure Enclave (Apple)
- Firmware/driver support for EdDSA operations
- OS support for exposing Ed25519 to WebAuthn API

**Most authenticators support:**
- P-256 (EC2) - widely supported since WebAuthn v1
- RSA - legacy compatibility

### Browser Implementation

- **Chrome 108+**: Added Ed25519 support (December 2022)
- **Safari 17+**: Added Ed25519 support with macOS 14/iOS 17 (September 2023)
- **Firefox**: Limited/experimental support
- **Edge 108+**: Follows Chrome implementation

### Platform Authenticators

| Platform | P-256 | Ed25519 | Notes |
|----------|-------|---------|-------|
| Windows 11 22H2+ | ✅ | ✅ | Requires TPM 2.0 + Chrome 108+ |
| Windows 11 21H2 | ✅ | ❌ | Older build |
| Windows 10 | ✅ | ❌ | TPM may not support Ed25519 |
| macOS 14+ | ✅ | ✅ | Requires Safari 17+ |
| macOS 13 | ✅ | ❌ | Secure Enclave, no Ed25519 API |
| iOS 17+ | ✅ | ✅ | Native support |
| iOS 16 | ✅ | ❌ | Face ID/Touch ID, no Ed25519 |
| Android | ✅ | ❌ | Most devices |

## Fallback Architecture

The system has a robust 3-tier fallback:

```
1. Try Hardware Ed25519 (Best Security)
   ↓ (if authenticator doesn't support Ed25519)
2. Try Worker Mode with PRF (Good Security)
   ↓ (if PRF extension not available)
3. Worker Mode with credentialId (Basic Security)
```

### Security Comparison

| Mode | Key Storage | Encryption Key Source | Extraction Risk |
|------|-------------|----------------------|-----------------|
| Hardware Ed25519 | TPM/Secure Enclave | N/A (never extracted) | ❌ None |
| Worker + PRF | localStorage (encrypted) | WebAuthn PRF | ⚠️ Extensions/XSS |
| Worker + credentialId | localStorage (encrypted) | credentialId hash | ⚠️ Extensions/XSS |

## User Experience

### First-Time Setup (Without Ed25519)

**Console Output:**
```
🔍 Checking for hardware-backed Ed25519 support...
✅ Hardware Ed25519 supported! Attempting to use hardware mode...
🔑 Creating new hardware-backed Ed25519 credential...
🔑 Creating WebAuthn Ed25519 credential (hardware-backed)...
🔍 Authenticator returned COSE key: {kty: 2, ktyName: 'EC2', alg: -7, algName: 'ES256', ...}
⚠️ Authenticator used EC2 (P-256) instead of OKP (Ed25519)
💡 This authenticator does not support Ed25519. Falling back to worker mode.
⚠️ Hardware initialization failed, falling back to worker mode
🆕 Creating new WebAuthn P-256 credential with PRF extension...
✅ Using WebAuthn PRF extension for key derivation
✅ Created and stored new Ed25519 DID with encrypted archive
```

**User sees:** Clear explanation of why hardware mode isn't available, seamless fallback to secure worker mode.

### First-Time Setup (With Ed25519)

**Console Output:**
```
🔍 Checking for hardware-backed Ed25519 support...
✅ Hardware Ed25519 supported! Attempting to use hardware mode...
🔑 Creating new hardware-backed Ed25519 credential...
🔑 Creating WebAuthn Ed25519 credential (hardware-backed)...
🔍 Authenticator returned COSE key: {kty: 1, ktyName: 'OKP', alg: -8, algName: 'EdDSA', crv: 6, crvName: 'Ed25519'}
✅ Successfully extracted Ed25519 public key (32 bytes)
✅ Created WebAuthn Ed25519 credential
   DID: did:key:z6Mk...
✅ Hardware-backed Ed25519 signer initialized
```

**User sees:** Green security banner "🔒 Hardware Mode Active" with celebration of secure configuration.

## Next Steps

### Testing Recommendations

1. **Clear localStorage** before testing to trigger fresh credential creation
2. **Test in multiple browsers** to see different diagnostic outputs
3. **Check console logs** for detailed COSE key information
4. **Verify PRF availability** (DuckDuckGo has it, Brave doesn't)

### Future Improvements

1. **Add UI indicator** showing which algorithm was attempted
2. **Store algorithm info** in localStorage for display
3. **Add "retry with hardware" button** if browser/OS is updated
4. **Detect browser version** and show upgrade path to Ed25519 support

## Technical Details

### COSE Key Type Values

- `kty: 1` = OKP (Octet Key Pair - Ed25519)
- `kty: 2` = EC2 (Elliptic Curve - P-256)
- `kty: 3` = RSA

### COSE Algorithm Values

- `alg: -8` = EdDSA (Ed25519)
- `alg: -7` = ES256 (P-256)
- `alg: -257` = RS256 (RSA)

### COSE Curve Values

- `crv: 6` = Ed25519
- `crv: 1` = P-256

## References

- [WebAuthn Level 3 Spec](https://www.w3.org/TR/webauthn-3/)
- [COSE Key Parameters](https://www.iana.org/assignments/cose/cose.xhtml)
- [Chrome Ed25519 Support](https://chromium.googlesource.com/chromium/src/+/main/content/browser/webauth/pub_key_cred_params.md)
- [WebAuthn PRF Extension](https://w3c.github.io/webauthn/#prf-extension)

## Files Modified

- `web/src/lib/webauthn-ed25519-signer.ts`: Enhanced diagnostics and multi-algorithm support
- `web/src/lib/webauthn-varsig/decoder.ts`: Created missing decoder module
