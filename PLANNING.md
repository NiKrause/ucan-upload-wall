# 🚀 Future Planning & Roadmap

This document outlines the planned evolution of the UCAN Upload Wall project toward production-ready, hardware-backed security.

## Overview

The project will evolve through five major phases:

0. **UCAN Revocation** - Implement delegation revocation and lifecycle management ✅
1. **Hardware Varsig v1** - Hardware-backed WebAuthn Ed25519 with varsig v1 wrapper (PARTIAL)
2. **Secure Credential Storage** - Worker fallback hardening (largeBlob + Storacha) (PRIORITY)
3. **Multi-Device DKG** - Distributed key generation across multiple devices
4. **Production Hardening** - Security audits and deployment

---

## Phase 0: UCAN Revocation (Immediate Priority)

**Goal**: Close the security gap by implementing delegation revocation and validation, enabling proper lifecycle management of UCAN delegations.

### Why This Comes First

**Critical Security Need**: The application currently creates and shares UCAN delegations, but has no way to revoke them. This means:
- Lost or stolen devices retain permanent access
- Mistakenly delegated permissions cannot be withdrawn
- No defense against compromised delegations
- Cannot enforce time-limited access policies

This is a **security vulnerability** that must be addressed before any other major changes.

### Roadmap

- [x] **Revocation API Implementation**
  - [x] Add `revokeDelegation()` method to `UCANDelegationService`
  - [x] Implement revocation invocation using `@storacha/capabilities/ucan`
  - [x] Send revocation requests to Storacha service (`did:web:up.storacha.network`)
  - [x] Handle revocation responses and error cases

- [x] **Revocation Status Checking**
  - [x] Implement `isDelegationRevoked()` using Storacha revocation registry
  - [x] Query `https://up.storacha.network/revocations/[CID]` API
  - [x] Add `validateDelegation()` to check expiration and revocation status
  - [x] Cache revocation checks to minimize API calls

- [x] **Pre-Operation Validation**
  - [x] Add revocation checks before upload operations
  - [x] Add revocation checks before list operations
  - [x] Add revocation checks before delete operations
  - [x] Return clear error messages when using revoked delegations

- [x] **User Interface**
  - [x] Add "Revoke" button to created delegations in `DelegationManager`
  - [x] Show revocation status badges (Active, Revoked, Expired) on delegation cards
  - [x] Add confirmation dialog when revoking ("This action cannot be undone")
  - [x] Visual indicators for revoked/expired delegations (red banner, strikethrough)
  - [x] Show revocation timestamp and revoker DID when applicable

- [ ] **Testing & Documentation**
  - [x] Test revocation flow: create → share → revoke → verify blocked
  - [x] Test that issuer can revoke their created delegations
  - [x] Test that audience can revoke delegations they received
  - [x] Document revocation API in README
  - [x] Add revocation examples to user guide

**Timeline**: 1-2 weeks

**Benefits**:
- 🔒 **Security**: Ability to revoke compromised or mistaken delegations
- ✅ **Access Control**: Enforce time-limited access and permissions
- 🛡️ **Risk Mitigation**: Reduce impact of lost/stolen devices
- 📋 **Audit Trail**: Track delegation lifecycle and revocations
- 🚀 **Production Ready**: Essential feature for real-world deployment

**Technical Details**:
- Works with existing Ed25519 DID implementation
- Uses Storacha's built-in revocation registry
- Revocation tracked by UCAN CID
- Both issuer and audience can revoke
- Revocations are permanent and cannot be undone

**References**:
- [Storacha Revocation API](https://github.com/storacha/upload-service/blob/main/packages/upload-api/src/ucan/revoke.js)
- [Agent Revoke Implementation](https://github.com/storacha/upload-service/blob/main/packages/access-client/src/agent.js#L259)
- Revocation Registry: `https://up.storacha.network/revocations/`
- [Implementation Details](./docs/REVOCATION_IMPLEMENTATION.md)

---

## Phase 1: Hardware Varsig v1 (Partial)

**Goal**: Use hardware-backed WebAuthn Ed25519 signatures wrapped in varsig v1 for UCAN signing, with a worker-based fallback where hardware Ed25519 is unavailable.

**Status**: ✅ Ed25519 supported, ❌ hardware P-256 not supported yet.

### Current Implementation
- [x] Varsig v1 header + strict parsing (`0x34 0x01`)
- [x] WebAuthn Ed25519 assertion wrapper + verification policy
- [x] Hardware-first signing flow with worker fallback
- [ ] Hardware P-256 support (blocked)

### Remaining Work (P-256 Dependency)
- [ ] Add ECDSA metadata path (0xEC + secp256r1)
- [ ] Implement P-256 WebAuthn verification path (DER conversion if needed)
- [ ] Enable hardware P-256 flow and update docs/tests

**References**:
- [Varsig v1 WebAuthn Implementation](./docs/varsig-implementation.md)
- [Architecture Flow](./docs/ARCHITECTURE_FLOW.md)

---

## Phase 2: Secure Credential Storage (High Priority)

**Goal**: Eliminate localStorage vulnerabilities for the **worker fallback** path by implementing a hybrid storage architecture using WebAuthn largeBlob and Storacha decentralized storage.

### Scope and Priority

This phase applies **only** when hardware-backed WebAuthn (Passkeys) is unavailable and we fall back to the worker-based Ed25519 path. Hardware-backed keys do not store extractable key material, so secure credential storage is **not required** for the primary path.

### Why This Comes After Revocation

With revocation in place, we can now safely store credentials in decentralized storage knowing we can revoke access if needed. While the current implementation **already encrypts** data in localStorage, Phase 1 provides:

1. **Hardware isolation**: Move encrypted credentials behind WebAuthn largeBlob (requires biometric per access)
2. **Reduced attack surface**: No credentials in localStorage at all (not even encrypted)
3. **Cross-device sync**: Credentials backed up to Storacha for recovery
4. **Defense in depth**: Even if same-origin code is injected after unlock, credentials aren't in localStorage

The current system protects against **external attackers** (XSS, extensions stealing localStorage), but Phase 1 additionally protects against **same-origin code injection** that could access worker memory after the initial unlock.

### The Problem

**Current localStorage characteristics:**
- ✅ **Encrypted at rest**: Ed25519 archives encrypted with AES-GCM before localStorage
- ✅ **Hardware-derived key**: Encryption key derived from WebAuthn PRF (never stored)
- ✅ **Biometric-gated**: Decryption requires WebAuthn authentication on every page load
- ⚠️ **XSS can steal encrypted data**: But cannot decrypt without WebAuthn credential
- ⚠️ **Browser extensions can read**: But only get encrypted ciphertext + IV
- ⚠️ **Lost device**: Encrypted archives accessible but require biometric to decrypt
- ❌ **Same-origin code injection**: Can access Web Worker memory after initial unlock
- ❌ **No hardware key isolation**: Ed25519 keys in JavaScript memory (not in TPM/Secure Enclave)

### The Solution: Three-Tier Architecture

```
Tier 1: WebAuthn largeBlob (Hardware-Protected)
   ├─ Bootstrap data (< 2KB)
   ├─ Storacha CID pointer
   └─ Requires biometric authentication
        ↓
Tier 2: Storacha (Decentralized Storage)
   ├─ Full encrypted credentials
   ├─ All UCAN delegations
   └─ Configuration metadata
        ↓
Tier 3: localStorage (Cache Only)
   ├─ Performance optimization
   └─ Rebuilt from Storacha on demand
```

### Roadmap

- [ ] **WebAuthn largeBlob Integration**
  - [ ] Detect largeBlob support (Chrome 92+, Safari 17+)
  - [ ] Implement largeBlob read/write functions
  - [ ] Store bootstrap CID in largeBlob
  - [ ] Handle authentication for largeBlob access
  - [ ] Fallback to localStorage for unsupported browsers

- [ ] **Storacha Credential Storage**
  - [ ] Design credential JSON schema
  - [ ] Encrypt credentials with WebAuthn PRF-derived key
  - [ ] Upload encrypted credentials to Storacha
  - [ ] Store resulting CID in largeBlob
  - [ ] Implement versioning for credential updates

- [ ] **Credential Retrieval**
  - [ ] Read CID from largeBlob on login
  - [ ] Fetch encrypted credentials from Storacha
  - [ ] Decrypt with WebAuthn PRF
  - [ ] Validate credential integrity
  - [ ] Handle network failures gracefully

- [ ] **Cache Management**
  - [ ] Mark localStorage as cache (not source of truth)
  - [ ] Implement cache invalidation (1-hour TTL)
  - [ ] Background sync from Storacha
  - [ ] Handle cache clearing without data loss
  - [ ] Add "Sync Now" button in UI

- [ ] **Migration Tool**
  - [ ] Create migration wizard for existing users
  - [ ] Export from localStorage
  - [ ] Upload to Storacha
  - [ ] Store CID in largeBlob
  - [ ] Verify migration success
  - [ ] Rollback on failure

- [ ] **Solving the Chicken-and-Egg Problem**
  - [ ] Option A: Store minimal read-only key in largeBlob
  - [ ] Option B: Public CID with encryption-only security
  - [ ] Implement bootstrap key derivation
  - [ ] Test cross-device recovery

**Timeline**: 8-12 weeks

**Benefits**:
- 🔒 **Hardware Protection**: Credentials protected by authenticator
- ✅ **XSS Resistant**: Requires biometric for access
- 🌐 **Decentralized**: No central credential database
- 🔄 **Recoverable**: Lost device → fetch from Storacha
- 💾 **Cross-Device**: largeBlob syncs (some authenticators)
- 🚀 **Performance**: localStorage cache for speed

**Technical Details**:
- **largeBlob limit**: 2KB (perfect for CID pointer)
- **Encryption**: AES-GCM with WebAuthn PRF-derived key
- **Storage**: Credentials uploaded to Storacha as encrypted JSON
- **Fallback**: localStorage for browsers without largeBlob support
- **Recovery**: Authenticator sync or manual Storacha fetch

**Security Improvements**:

| Attack Vector | Current (localStorage + Worker) | After (largeBlob + Storacha) |
|--------------|--------------------------------|------------------------------|
| XSS Injection | ⚠️ Gets encrypted data only | ✅ No credentials in localStorage at all |
| Browser Extension | ⚠️ Can read encrypted archives | ✅ Cannot access largeBlob |
| Code Injection (same-origin) | ❌ Can access worker memory after unlock | ✅ largeBlob requires biometric per access |
| Lost Device | ⚠️ Encrypted but no recovery | ✅ Recoverable from Storacha |
| Physical Access | ✅ Encrypted + requires biometric | ✅ Same, but with decentralized backup |
| Offline Access | ✅ Full functionality | ⚠️ Initial load requires network |

**References**:
- [W3C WebAuthn Level 3 - largeBlob](https://www.w3.org/TR/webauthn-3/#sctn-large-blob-extension)
- [Storacha Documentation](https://docs.storacha.network/)
- [Implementation Guide](./docs/SECURE_CREDENTIAL_STORAGE.md)
- [SECURITY.md](./SECURITY.md) - Current localStorage vulnerabilities

---

## Phase 3: Multi-Device DKG Architecture (Long-term)

**Goal**: Implement true multi-device security using Distributed Key Generation (DKG) with threshold cryptography.

### Concept

Instead of a single Ed25519 key in one browser, split the key across **at least two devices** using threshold cryptography:

```
Device 1 (Browser)     Device 2 (Mobile)
      ↓                       ↓
  Key Share 1            Key Share 2
      ↓                       ↓
      └─────────┬─────────────┘
                ↓
         Combined Signature
         (requires BOTH devices)
```

### Architecture

**Multi-Device Flow:**

1. **Browser**: User initiates UCAN signing request
2. **Browser**: Generates QR code with signing request + PWA URL (e.g., IPFS URL)
3. **Mobile**: Scans QR code, opens same PWA
4. **Mobile**: Authenticates with Passkey (biometric confirmation)
5. **Communication**: Devices communicate via js-libp2p (local network or public DHT)
6. **Signing**: Both devices combine their key shares to create signature
7. **Result**: UCAN signed only with approval from both devices

### Security Benefits

- ✅ **No single point of failure** - compromise of one device doesn't expose private key
- ✅ **Multi-factor authentication** - requires physical access to both devices
- ✅ **Hardware-backed on both devices** - each device uses WebAuthn/Passkey
- ✅ **User confirmation** - explicit biometric approval on second device
- ✅ **Threshold signing** - k-of-n devices required (e.g., 2-of-2, 2-of-3)

### Additional Features

- Key shares stored encrypted on Storacha (under DKG circumstances)
- Recovery possible with threshold of devices
- Compatible with Google/Chrome multi-device Passkeys
- Enables secure UCAN chaining and delegation

### Technical Components

**Roadmap Items:**

- [ ] Research threshold signature schemes for Ed25519 (e.g., FROST)
- [ ] Compare OrbitDB-DKG tests: https://github.com/NiKrause/dkg-orbitdb
- [ ] Implement js-libp2p communication layer
  - [ ] Local network discovery (mDNS) - not available in browsers
  - [ ] Public DHT fallback
  - [ ] Encrypted peer-to-peer channels
- [ ] QR code signing flow UI/UX
- [ ] Multi-device Passkey coordination
- [ ] Key share generation and storage
  - [ ] Encrypted storage on Storacha
  - [ ] Share recovery mechanism
- [ ] Threshold signature protocol implementation
- [ ] Mobile PWA optimization
- [ ] Cross-device session management
- [ ] Security audit of DKG implementation

**Timeline**: 12-24 months (research + implementation)

### Technical References

- **FROST**: Flexible Round-Optimized Schnorr Threshold signatures
- **js-libp2p**: Modular peer-to-peer networking stack
- **OrbitDB DKG**: Existing DKG implementation for reference
- **WebAuthn Level 3**: Future standards for enhanced credential capabilities

---

## Phase 4: Production Hardening

**Goal**: Prepare the application for production use with comprehensive security validation.

### Roadmap

- [ ] Comprehensive security audit by third-party
- [ ] Penetration testing
- [ ] Formal verification of cryptographic protocols
- [ ] Bug bounty program
- [ ] Production deployment infrastructure
- [ ] User documentation and security best practices
- [ ] Compliance review (GDPR, data protection)

**Timeline**: 6-12 months after Phase 2

**Dependencies**: Should be performed after:
- Phase 0 (Revocation) ✅
- Phase 1 (Secure Storage) - Recommended
- Phase 2 (DKG) - Recommended for maximum security

---

## Contributing to the Roadmap

Want to help accelerate this roadmap?

1. **🔥 Current Priority: Secure Storage** (Phase 1): Help implement largeBlob + Storacha credential storage
2. **✅ Completed: Revocation** (Phase 0): UCAN revocation is now implemented and working!
3. **Research DKG**: Investigate threshold signature schemes (FROST, GG20, etc.)
4. **Review Code**: Help audit implementations
5. **Documentation**: Improve technical documentation and guides

---

## Questions & Discussion

For questions about this roadmap or to propose new features:

- Open an issue on GitHub
- Reference this document in discussions
- Tag issues with `roadmap` or `planning`

---

## Related Documents

- [SECURITY.md](./SECURITY.md) - Security considerations and current limitations
- [README.md](./README.md) - Project overview and getting started
- [LICENSE](./LICENSE) - MIT License
