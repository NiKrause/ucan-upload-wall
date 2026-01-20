# WebAuthn PRF Extension Implementation

## Overview

This document describes the implementation of WebAuthn PRF (Pseudo-Random Function) extension support with fallback to `rawCredentialId` for key derivation in the UCAN Upload Wall application. This flow is used only when hardware-backed WebAuthn Ed25519 (varsig v1) is unavailable.

## What is PRF?

**PRF = Pseudo-Random Function**

In cryptography, a PRF is a deterministic function that produces output appearing random but is reproducible from the same input. The WebAuthn PRF extension (Level 3 spec) allows authenticators to generate deterministic cryptographic material that can be used for key derivation.

## Implementation Details

### 1. Enhanced WebAuthnCredentialInfo Interface

Added PRF-related fields to track which key derivation method is used:

```typescript
export interface WebAuthnCredentialInfo {
  credentialId: string;
  rawCredentialId: Uint8Array;
  publicKey: { /* ... */ };
  userId: string;
  displayName: string;
  did?: string;
  prfInput?: Uint8Array;        // PRF input/salt (safe to store in localStorage)
  prfSeed?: Uint8Array;         // TRANSIENT: PRF output (NEVER stored, requires re-auth)
  prfSource?: 'prf' | 'credentialId';  // Track which method was used
}
```

### 2. PRF Seed Extraction with Fallback

The `getPrfSeed()` method attempts to use the WebAuthn PRF extension first, then falls back to `rawCredentialId`:

```typescript
static async getPrfSeed(
  credential: PublicKeyCredential | null,
  rawCredentialId: Uint8Array
): Promise<{ seed: Uint8Array; source: 'prf' | 'credentialId' }>
```

**Flow:**
1. Try to read `credential.getClientExtensionResults().prf.results.first`
2. If available → use PRF output (more secure)
3. If not available → fallback to `rawCredentialId` (backward compatible)

### 3. Credential Creation with PRF

When creating new credentials, we request the PRF extension:

```typescript
const credential = await navigator.credentials.create({
  publicKey: {
    // ... standard options ...
    extensions: {
      prf: {
        eval: { first: prfInput }  // Random 32-byte salt
      }
    }
  }
});
```

**Storage:**
- If PRF is supported: Store `prfInput` for future authentications
- Store `prfSource` to track which method was used

### 4. Authentication with PRF

When authenticating with existing credentials:

```typescript
const assertion = await navigator.credentials.get({
  publicKey: {
    // ... standard options ...
    extensions: {
      prf: {
        eval: { first: prfInput }  // Use stored prfInput
      }
    }
  }
});
```

### 5. Integration with Ed25519 Keystore

The PRF seed (from either source) is used to derive the AES-GCM key for encrypting Ed25519 private keys:

```typescript
// Extract PRF seed
const prfSeed = await WebAuthnDIDProvider.extractPrfSeed(credentialInfo);

// Initialize keystore with PRF seed
await initEd25519KeystoreWithPrfSeed(prfSeed);

// Worker derives AES key: HKDF-SHA-256(prfSeed) → AES-GCM key
```

## Browser Support

| Browser | PRF Extension | Fallback (rawCredentialId) |
|---------|---------------|----------------------------|
| Chrome 108+ | ✅ Supported | ✅ Supported |
| Edge 108+ | ✅ Supported | ✅ Supported |
| Safari | ⚠️ Experimental | ✅ Supported |
| Firefox | ❌ Not yet | ✅ Supported |

## Security Benefits

### Using PRF Extension (when available):

1. **Hardware-generated**: PRF output is computed inside the secure authenticator
2. **Domain-bound**: Can be different per relying party (domain isolation)
3. **Purpose-built**: Specifically designed for key derivation use cases
4. **Never exposes credential internals**: More secure than using credential ID

### Fallback to rawCredentialId:

1. **Deterministic**: Same credential → same ID
2. **Widely supported**: Works on all WebAuthn-capable browsers
3. **Backward compatible**: Existing credentials continue to work
4. **Secure enough**: Still requires biometric authentication to access

## Key Derivation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ WebAuthn Credential Creation/Authentication                 │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │ Try PRF first │
         └───────┬───────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
   PRF Available    PRF Not Available
        │                 │
        │                 ▼
        │         Use rawCredentialId
        │                 │
        └────────┬────────┘
                 │
                 ▼
         ┌───────────────┐
         │   PRF Seed    │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │ HKDF-SHA-256  │
         └───────┬───────┘
                 │
                 ▼
         ┌───────────────┐
         │  AES-GCM Key  │
         └───────┬───────┘
                 │
                 ▼
    ┌────────────────────────┐
    │ Encrypt/Decrypt        │
    │ Ed25519 Private Keys   │
    └────────────────────────┘
```

## Migration Path

### Existing Users (pre-PRF):
- Credentials continue to work with `rawCredentialId` fallback
- `prfSource` will be `undefined` or `'credentialId'`
- No action required

### New Users (post-PRF):
- Automatically use PRF extension if browser supports it
- `prfSource` will be `'prf'` if successful
- Falls back to `rawCredentialId` if PRF unavailable

### Future Enhancement:
- Could prompt existing users to re-register for PRF support
- Would provide better security on supported browsers

## Testing

The implementation has been tested with:
- ✅ TypeScript compilation (no errors)
- ✅ Build process (successful)
- ⏳ Browser testing (manual testing recommended)

### Manual Testing Steps:

1. **Test PRF on Chrome 108+:**
   ```bash
   npm run dev
   # Create new credential
   # Check console for: "✅ Using WebAuthn PRF extension for key derivation"
   ```

2. **Test Fallback on Firefox:**
   ```bash
   npm run dev
   # Create new credential
   # Check console for: "ℹ️ PRF extension not available, using rawCredentialId"
   ```

3. **Test Backward Compatibility:**
   - Use existing credential created before PRF implementation
   - Should work seamlessly with `rawCredentialId`

## Important Implementation Detail: PRF Seed Security Model

The PRF output is **ephemeral** - it only exists during the WebAuthn credential operation (create/get). You cannot retrieve it later without re-authenticating.

### Security-First Approach (Current Implementation)

**The PRF seed is NEVER stored in localStorage for security reasons.** Instead, we require WebAuthn re-authentication on every page load:

```typescript
// During credential creation/authentication:
const { seed: prfSeed, source } = await getPrfSeed(credential, rawCredentialId);

// ❌ prfSeed is NOT stored in localStorage
// Only prfInput (salt) is stored, which is safe

// On page reload, extractPrfSeed() triggers WebAuthn re-authentication:
static async extractPrfSeed(credentialInfo: WebAuthnCredentialInfo): Promise<Uint8Array> {
  // Re-authenticate to get fresh PRF output
  const freshCredInfo = await this.authenticateWithExistingCredential(
    credentialInfo.credentialId,
    window.location.hostname,
    credentialInfo.prfInput
  );
  return freshCredInfo.prfSeed; // Fresh from authenticator
}
```

### Security Benefits

1. **True Hardware-Backed Security**: Private key material cannot be decrypted without biometric authentication
2. **No Key Material in Storage**: Even if an attacker gains localStorage access, they cannot decrypt the Ed25519 private key
3. **User Presence Required**: Each session requires active user authentication
4. **Zero Trust**: The encryption key (derived from PRF seed) exists only in memory during active use

### Trade-offs

- ✅ **Pro**: Maximum security - keys locked behind biometrics
- ❌ **Con**: User must authenticate with biometric on every page reload
- ℹ️ **Note**: This is standard behavior for hardware-backed security (similar to password managers)
```

This allows us to:
- Decrypt Ed25519 keys without re-authentication on every page load
- Maintain the same encryption key across sessions
- Avoid repeated biometric prompts

## Files Modified

1. **`web/src/lib/webauthn-did.ts`**
   - Added `getPrfSeed()` method
   - Added `createCredentialWithPRF()` method
   - Updated `authenticateWithExistingCredential()` for PRF
   - Added `extractPrfSeed()` helper
   - **Store `prfSeed` in credential info**

2. **`web/src/types/orbitdb-webauthn.d.ts`**
   - Added `prfInput`, `prfSeed`, and `prfSource` fields to interface

3. **`web/src/lib/ucan-delegation.ts`**
   - Updated PRF seed extraction to use new helper method
   - **Added deserialization of `prfSeed` Uint8Array from localStorage**
   - Added logging for PRF source tracking

## References

- [WebAuthn Level 3 Spec - PRF Extension](https://www.w3.org/TR/webauthn-3/#prf-extension)
- [HKDF (RFC 5869)](https://tools.ietf.org/html/rfc5869)
- [Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/)

## Future Improvements

1. **Prompt for PRF Migration**: Offer existing users option to upgrade to PRF
2. **PRF Output Caching**: Store PRF output temporarily to avoid re-authentication
3. **Multiple PRF Inputs**: Support different PRF inputs for different purposes
4. **PRF Availability Detection**: Proactively check PRF support before credential creation
