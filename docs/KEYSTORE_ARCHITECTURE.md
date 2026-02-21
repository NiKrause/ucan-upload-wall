# 🔐 Keystore Architecture

## Overview

This document explains how the Ed25519 keystore works in the UCAN Upload Wall application, including the relationship between the PRF seed, encryption keys, and keypair storage.

---

## Architecture Components

### 1. Web Worker-Based Keystore

The Ed25519 keystore runs in a dedicated web worker (`ed25519-keystore.worker.ts`) to isolate cryptographic operations from the main thread.

**Key Properties:**
- ✅ Cryptographic keys never leave the worker context
- ✅ All crypto operations (sign, verify, encrypt, decrypt) happen in worker
- ✅ Main thread only receives public keys and encrypted data
- ⚠️ Keys exist in worker memory only (lost when worker terminates)

### 2. Storage Model

```
┌─────────────────────────────────────────────────────────┐
│ WebAuthn PRF Extension (or fallback to credentialId)    │
│ • Generates deterministic PRF seed from credential      │
│ • Same credential → same PRF seed (every time)          │
│ • PRF output is EPHEMERAL (only exists during auth)     │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Store PRF Seed in localStorage                          │
│ • WEBAUTHN_CREDENTIAL: { ..., prfSeed, prfSource }      │
│ • Allows reuse without re-authentication                │
│ • Trade-off: UX vs. hardware-only security              │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Worker: Derive AES-GCM Key (HKDF-SHA-256)               │
│ • PRF seed → deterministic AES-GCM key                  │
│ • Same PRF seed → same AES key                          │
│ • Key stored in worker memory only (not in localStorage)│
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Worker: Generate Ed25519 Keypair                        │
│ • crypto.subtle.generateKey() - RANDOM generation       │
│ • NOT derived from PRF seed                             │
│ • Keypair stored in worker memory                       │
│ • Private key exported to archive format                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Worker: Encrypt Archive                                 │
│ • Archive = { id, keys: { [did]: Uint8Array } }         │
│ • Encrypted with AES-GCM key (from PRF)                 │
│ • Output: { ciphertext, iv }                            │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│ localStorage (Persistent Storage)                       │
│ • ED25519_ARCHIVE_ENCRYPTED: { ciphertext, iv }         │
│ • ED25519_KEYPAIR: { publicKey, did, privateKey: '' }   │
│ • WEBAUTHN_CREDENTIAL: { ..., prfSeed, prfSource }      │
│ • Archive encrypted, but PRF seed is accessible         │
└─────────────────────────────────────────────────────────┘
```

---

## Key Derivation vs. Key Generation

### AES-GCM Key: **Deterministically Derived** ✅

The AES encryption key is derived from the PRF seed using HKDF-SHA-256:

```typescript
// web/src/workers/ed25519-keystore.worker.ts
async function deriveAesKeyFromPrfSeed(prfSeed: ArrayBuffer): Promise<CryptoKey> {
  // Derive salt deterministically from PRF seed
  const saltHash = await crypto.subtle.digest('SHA-256', prfSeed);
  const salt = new Uint8Array(saltHash).slice(0, 16);
  const info = new TextEncoder().encode('ucan-upload-wall/ed25519-keystore');

  const baseKey = await crypto.subtle.importKey('raw', prfSeed, 'HKDF', false, ['deriveKey']);

  return await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

**Properties:**
- Same PRF seed → Same AES key (every time)
- Allows decryption of previously encrypted archives
- Key derivation is repeatable and deterministic

### Ed25519 Keypair: **Randomly Generated** 🎲

The Ed25519 keypair is generated randomly, NOT derived from the PRF:

```typescript
// web/src/workers/ed25519-keystore.worker.ts
case 'generateKeypair': {
  // Generate NEW random keypair
  ed25519KeyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  
  // Export and create archive
  const secret = new Uint8Array(privateKeyPkcs8).slice(-32);
  const edSigner = await deriveEdSigner(secret);
  const archive = edSigner.toArchive();
  
  // Return archive to be encrypted
  return { publicKey, archive };
}
```

**Properties:**
- Each call generates a NEW random keypair
- NOT deterministic from PRF seed
- Must be stored (encrypted) to persist across sessions

---

## Lifecycle: First Use

### Step 1: Create WebAuthn Credential with PRF
```typescript
// User creates WebAuthn credential
const credential = await navigator.credentials.create({
  publicKey: {
    extensions: {
      prf: { eval: { first: new Uint8Array(32) } }
    }
  }
});
```

### Step 2: Extract and Store PRF Seed
```typescript
// Get PRF output (deterministic seed) - fallback to rawCredentialId if PRF unavailable
const { seed: prfSeed, source } = await getPrfSeed(credential, rawCredentialId);
// → This seed will be the SAME every time this credential is used

// Store PRF seed in credential info (allows reuse without re-authentication)
credentialInfo.prfSeed = prfSeed;
credentialInfo.prfSource = source;  // 'prf' or 'credentialId'
localStorage.setItem('WEBAUTHN_CREDENTIAL', JSON.stringify(credentialInfo));
```

### Step 3: Initialize Keystore
```typescript
// Worker derives AES key from PRF seed
await initEd25519KeystoreWithPrfSeed(prfSeed);
// → HKDF-SHA-256(prfSeed) → AES-GCM key (stored in worker memory)
```

### Step 4: Generate Ed25519 Keypair
```typescript
// Worker generates RANDOM Ed25519 keypair
const { publicKey, did, archive } = await generateWorkerEd25519DID();
// → Random keypair generated
// → Archive contains private key material
```

### Step 5: Encrypt and Store Archive
```typescript
// Worker encrypts archive with AES key
const { ciphertext, iv } = await encryptArchive(archive);

// Store encrypted archive in localStorage
localStorage.setItem('ED25519_ARCHIVE_ENCRYPTED', JSON.stringify({
  ciphertext: hex(ciphertext),
  iv: hex(iv)
}));

// Store public key (unencrypted - it's public anyway)
localStorage.setItem('ED25519_KEYPAIR', JSON.stringify({
  publicKey: hex(publicKey),
  privateKey: '', // Not stored here
  did
}));
```

---

## Lifecycle: Subsequent Use

### Step 1: Load Stored PRF Seed (No Re-Authentication Needed)
```typescript
// Load stored credential info from localStorage
const storedCredential = localStorage.getItem('WEBAUTHN_CREDENTIAL');
const credentialInfo = JSON.parse(storedCredential);

// Restore PRF seed from storage
if (credentialInfo.prfSeed) {
  credentialInfo.prfSeed = new Uint8Array(Object.values(credentialInfo.prfSeed));
}

// Extract PRF seed (already stored from initial authentication)
const prfSeed = await WebAuthnDIDProvider.extractPrfSeed(credentialInfo);
// → Uses stored prfSeed, no biometric prompt needed for page reload
```

**Note:** The PRF seed was captured during initial credential creation/authentication and is now stored in localStorage for reuse.

### Step 2: Derive SAME AES Key
```typescript
// Worker derives AES key from PRF seed
await initEd25519KeystoreWithPrfSeed(prfSeed);
// → HKDF-SHA-256(prfSeed) → SAME AES-GCM key as before
```

### Step 3: Decrypt Archive
```typescript
// Load encrypted archive from localStorage
const stored = localStorage.getItem('ED25519_ARCHIVE_ENCRYPTED');
const { ciphertext, iv } = JSON.parse(stored);

// Worker decrypts archive with AES key
const archive = await decryptArchive(
  hexToBytes(ciphertext),
  hexToBytes(iv)
);
// → Original Ed25519 keypair restored
```

### Step 4: Restore Keypair in Worker
```typescript
// Worker imports keypair from archive
const edSigner = await deriveEdSigner(archive.keys[did]);
// → Keypair now available in worker memory for signing
```

---

## PRF Seed Storage Strategy

### Why Store the PRF Seed?

The WebAuthn PRF extension output is **ephemeral** - it only exists during the credential operation (create/get) and cannot be retrieved later without re-authentication. We have two options:

1. **Re-authenticate on every page reload** ❌
   - Requires biometric prompt every time user visits the app
   - Poor user experience
   - Defeats purpose of persistent web app

2. **Store PRF seed in localStorage** ✅ (Current implementation)
   - One-time authentication captures PRF seed
   - Seed stored for reuse across sessions
   - Better UX, acceptable security trade-off

### Security Trade-off Analysis

**What We Gain:**
- ✅ Seamless page reloads without biometric prompts
- ✅ Persistent encryption key for Ed25519 archives
- ✅ Standard web app UX expectations

**What We Risk:**
- ⚠️ PRF seed in localStorage accessible to XSS
- ⚠️ If attacker gets localStorage, they can decrypt Ed25519 archives

**Mitigation:**
- The PRF seed alone doesn't grant credential authority
- Ed25519 private keys are still encrypted
- Content Security Policy (CSP) reduces XSS risk
- Future: Move to largeBlob storage (see SECURE_CREDENTIAL_STORAGE.md)

### Alternative: WebAuthn largeBlob (Future)

The ideal solution is WebAuthn largeBlob extension:
- Stores PRF seed in hardware authenticator
- Requires biometric to access
- Syncs across devices (iCloud/Google)
- Not yet widely supported (Chrome/Edge 92+, Safari 17+)

See [SECURE_CREDENTIAL_STORAGE.md](./SECURE_CREDENTIAL_STORAGE.md) for planned migration.

---

## Security Properties

### ✅ Strengths

1. **Private keys never in main thread**
   - Ed25519 private key only exists in worker memory
   - Main thread only receives signatures, never private keys

2. **Deterministic encryption key**
   - Same WebAuthn credential → same AES key
   - Enables decryption of archives across sessions

3. **Hardware-backed PRF seed**
   - PRF seed derived from WebAuthn credential
   - Requires biometric/PIN authentication to access
   - Protected by TPM/Secure Enclave

4. **Encrypted private key at rest**
   - Ed25519 archive encrypted with AES-GCM before localStorage
   - Attacker with localStorage access gets ciphertext only

### ⚠️ Limitations

1. **PRF seed stored in localStorage (NEW)**
   - PRF seed stored unencrypted in localStorage for UX
   - XSS can steal PRF seed and decrypt Ed25519 archives
   - Trade-off: Better UX vs. hardware-only security
   - Mitigation: CSP, future largeBlob migration

2. **Keys in memory during session**
   - While worker is active, keys are in memory
   - Vulnerable to memory dumps if device is compromised

3. **localStorage still accessible to XSS**
   - Encrypted archive in localStorage
   - PRF seed also in localStorage (can decrypt)
   - XSS can steal both and decrypt Ed25519 keys

4. **Worker provides isolation, not true sandboxing**
   - Web workers share same origin
   - Not a security boundary against determined attacker

5. **AES key derivation is deterministic**
   - Same PRF seed → same AES key
   - If PRF seed is compromised, all archives are compromised

---

## Key Differences from Full PRF-Derived Keys

Some systems derive the Ed25519 keypair directly from a seed:

```typescript
// Alternative approach (NOT used in this codebase)
const seed = prfSeed; // or derive from PRF
const privateKey = await deriveKeyFromSeed(seed); // Deterministic
```

**Why this codebase doesn't do that:**

1. **Flexibility**: Random keypair generation allows for key rotation
2. **Ucanto compatibility**: Uses `@ucanto/principal/ed25519` archive format
3. **Separation of concerns**: PRF seed → encryption, not signing
4. **Archive-based model**: Supports multiple DIDs in single archive

**Trade-offs:**
- ❌ Requires encrypted storage (can't just regenerate from seed)
- ✅ Allows multiple DIDs without multiple PRF evaluations
- ✅ Standard archive format for interoperability

---

## Storage Keys Reference

```typescript
// web/src/lib/ucan-delegation.ts
const STORAGE_KEYS = {
  // Ed25519 Keys
  ED25519_KEYPAIR: 'ucan:ed25519:keypair',           // { publicKey, did, privateKey: '' }
  ED25519_ARCHIVE_ENCRYPTED: 'ucan:ed25519:archive', // { ciphertext, iv }
  
  // WebAuthn Credential Info (includes PRF seed)
  WEBAUTHN_CREDENTIAL: 'ucan:webauthn:credential',   // {
    //   credentialId, rawCredentialId, publicKey,
    //   prfInput, prfSeed, prfSource, did, userId, displayName
    // }
  
  // Storacha Credentials (UNENCRYPTED)
  STORACHA_KEY: 'ucan:storacha:key',
  STORACHA_PROOF: 'ucan:storacha:proof',
  SPACE_DID: 'ucan:storacha:space',
  
  // UCAN Delegations (UNENCRYPTED)
  CREATED_DELEGATIONS: 'ucan:delegations:created',
  RECEIVED_DELEGATIONS: 'ucan:delegations:received',
  
  // Revocation Cache (UNENCRYPTED)
  REVOCATION_CACHE: 'ucan:revocations:cache'
};
```

---

## Future Improvements

### Option 1: Derive Ed25519 from PRF
- Generate Ed25519 keypair deterministically from PRF seed
- No need to store encrypted archive
- Simpler model, but less flexible

### Option 2: WebAuthn largeBlob Storage
- Store encrypted archive in WebAuthn authenticator (2KB limit)
- Hardware-protected storage
- See `SECURE_CREDENTIAL_STORAGE.md` for full proposal

### Option 3: Encrypt All localStorage Data
- Extend AES encryption to Storacha credentials
- Extend AES encryption to UCAN delegations
- More comprehensive protection against physical access

---

## Related Documentation

- [SECURE_CREDENTIAL_STORAGE.md](./SECURE_CREDENTIAL_STORAGE.md) - Proposed three-tier architecture
- [web/src/lib/ucan-delegation.ts](../web/src/lib/ucan-delegation.ts) - App orchestration over standalone keystore APIs
- [web/src/workers/ed25519-keystore.worker.ts](../web/src/workers/ed25519-keystore.worker.ts) - Worker implementation
- [web/src/lib/webauthn-did.ts](../web/src/lib/webauthn-did.ts) - WebAuthn PRF integration

---

## FAQ

### Q: Why is the Ed25519 keypair random instead of derived from PRF?

**A:** This provides flexibility for key rotation and supports the Ucanto archive format. The PRF seed is used to protect the keypair (via encryption) rather than generate it directly.

### Q: What happens if the worker is terminated?

**A:** The keypair is lost from memory. On next authentication, the PRF seed derives the same AES key, which decrypts the archive from localStorage, restoring the keypair.

### Q: Can I regenerate my Ed25519 DID if I lose localStorage?

**A:** No. Since the keypair is randomly generated (not derived from PRF), losing the encrypted archive means losing the keypair forever. You'll need to create a new DID.

### Q: Is the PRF seed stored anywhere?

**A:** **Yes (as of WebAuthn PRF implementation).** The PRF seed is captured during credential creation/authentication and stored in localStorage as part of `WebAuthnCredentialInfo.prfSeed`. This allows:
- Decrypting Ed25519 keys without re-authentication on every page reload
- Maintaining the same AES-GCM encryption key across sessions
- Avoiding repeated biometric prompts for routine operations

The stored `prfSeed` field contains either:
- PRF extension output (if browser supports PRF extension), OR
- `rawCredentialId` bytes (as fallback for browsers without PRF support)

The `prfSource` field tracks which method was used: `'prf'` or `'credentialId'`.

**Security Note:** While the PRF seed is stored in localStorage, it was originally derived from a WebAuthn credential that requires biometric/PIN authentication to create. An attacker with localStorage access alone cannot recreate the initial authentication context.

### Q: Why not store the AES key in localStorage?

**A:** The AES key is derived from the PRF seed using HKDF. While the PRF seed IS now stored in localStorage (for UX), we don't also store the derived AES key because:
1. It's trivial to re-derive from the seed (HKDF is fast)
2. Keeping it only in worker memory provides minimal additional isolation
3. Reduces attack surface slightly (one less key in localStorage)

Note: Since the PRF seed is in localStorage, an attacker with XSS can derive the AES key anyway. The real protection comes from initial WebAuthn authentication that generated the PRF seed.

### Q: What if someone steals my encrypted archive from localStorage?

**A:** Since the PRF seed is also stored in localStorage (as of the PRF implementation), an attacker with localStorage access can:
1. Read the encrypted Ed25519 archive
2. Read the PRF seed
3. Derive the AES-GCM key (HKDF from PRF seed)
4. Decrypt the archive

**Protection relies on:**
- The initial WebAuthn authentication that generated the PRF seed
- Content Security Policy (CSP) to prevent XSS
- Browser security to isolate localStorage per origin
- Physical device security

**Important:** This is a conscious trade-off for better UX. The alternative (re-authenticating on every page load) is impractical for web apps. Future migration to WebAuthn largeBlob will improve this (see SECURE_CREDENTIAL_STORAGE.md).
