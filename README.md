# 🔐 UCAN Upload Wall

[![CI](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ci.yml)

> **⚠️ SECURITY WARNING**: This code has **NOT been security audited** and should **NOT be used in production**. See **[SECURITY.md](./SECURITY.md)** for critical security considerations, attack vectors, and limitations.

A browser-only file upload application powered by **WebAuthn DIDs**, **worker-based Ed25519 keystore**, and **UCAN delegations** on Storacha.

## 📑 Table of Contents

- [🌐 Live Demo](#-live-demo)
- [🎥 Demo Video](#-demo-video)
- [🏗️ Architecture](#️-architecture)
- [🚀 Features](#-features)
- [🔄 How It Works](#-how-it-works)
- [📦 Setup](#-setup)
- [🔐 Security](#-security)
- [🛠️ Technical Details](#️-technical-details)
- [📝 Notes](#-notes)
- [🔗 Resources](#-resources)
- [📚 Project Documentation](#-project-documentation)
- [📄 License](#-license)

## 🌐 Live Demo

**[Try it now →](https://dweb.link/ipfs/bafybeic6mefgeb7yrzdzytxlxxg5vngzosv7qxx4svogtmevon2rif2izm)**

⚠️ **Demo is for testing only** - do not use with valuable data (see security warnings above)

**To mitigate the above stated security risks**, please use the browser app only in:

- Browsers **without any installed browser extensions** (e.g., Chrome extensions), or
- **Mobile phones** where the attack surface is much smaller

## 🎥 Demo Video

[![UCAN Upload Wall Demo](https://img.youtube.com/vi/3ZqkgYMS1MM/hqdefault.jpg)](https://www.youtube.com/watch?v=3ZqkgYMS1MM)

*Click the image above to watch the demo video on YouTube*

## 🏗️ Architecture

> **📊 For detailed visual diagrams and flow charts, see [ARCHITECTURE_FLOW.md](./docs/ARCHITECTURE_FLOW.md)**  
> Includes sequence diagrams for WebAuthn, Ed25519 keystore, delegation flows, and complete end-to-end scenarios with Mermaid visualizations.

### **WebAuthn DID (P-256)**
- Hardware-secured identity using device biometrics (Face ID, Touch ID, Windows Hello)
- P-256 elliptic curve cryptography (WebAuthn also supports Ed25519)
- DID format: `did:key:zDna...` (P-256 public key)
- Used for: Initial authentication, PRF seed derivation
- **Note**: Cannot sign UCANs due to WebAuthn signature format (see [SECURITY.md](./SECURITY.md))

### **Worker-Based Ed25519 Keystore**
- Ed25519 keypair generated in a dedicated web worker
- AES-GCM encryption key derived from WebAuthn PRF seed (deterministic)
- Private key never leaves the worker (see Security warnings)
- DID format: `did:key:z6Mk...` (Ed25519 public key)
- Used for: UCAN signing, Storacha client principal

**Worker Functions:**
- `init(prfSeed)` - Initialize AES key from WebAuthn PRF seed
- `generateKeypair()` - Generate Ed25519 keypair and archive
- `encrypt(plaintext)` - Encrypt data with AES-GCM
- `decrypt(ciphertext, iv)` - Decrypt data with AES-GCM
- `sign(data)` - Sign data with Ed25519 private key
- `verify(data, signature)` - Verify Ed25519 signature

### **Key Flow**
```
WebAuthn Credential (P-256)
    ↓
rawCredentialId (PRF seed)
    ↓
Worker: HKDF-SHA-256 → AES-GCM key
    ↓
Worker: Generate Ed25519 keypair
    ↓
Worker: Create Ed25519Signer archive
    ↓
Encrypt archive with AES key → localStorage
    ↓
Reconstruct Ed25519Signer for Storacha client
```

## 🚀 Features

### **1. Generate Ed25519 DID**
- Automatically generated on first authentication
- Derived from WebAuthn credential (deterministic per credential)
- Stored encrypted in localStorage
- Format: `did:key:z6Mk...`

### **2. Create Delegation (Storacha CLI)**
```bash
# On Storacha CLI, create delegation for your Ed25519 DID
storacha delegation create did:key:z6Mkwa35STKQF1i5eoDYtQ4W1y6y6NbE9RXe3QiJt7aSK6uS --base64
```

This outputs a base64-encoded UCAN delegation proof.

### **3. Import Delegation**
- Paste the delegation proof from Storacha CLI
- App verifies the delegation is for your current Ed25519 DID
- **Format auto-detection**: Supports multiple formats including:
  - `multibase-base64` (Storacha CLI format with 'm' prefix)
  - `multibase-base64url` (with 'u' prefix)
  - CAR format, JSON format, and other legacy formats
- Delegation stored in localStorage with detected format displayed
- Capabilities: `upload/*`, `store/*`, `blob/*`, `space/*`, etc.

### **4. Upload File**
- Drag & drop or click to select
- File uploaded to Storacha using delegation
- Returns CID (Content Identifier)
- Files stored on Filecoin network

### **5. List Files**
- Lists all uploads in your Storacha space
- Uses delegation with `upload/list` capability
- Shows CID, upload date, shards

### **5.5. Download via Helia (IPFS)**
- Spins up a browser Helia node to fetch files directly over IPFS
- Falls back to public gateways if Helia cannot fetch
- Thumbnails use the same Helia-first blob pipeline

### **6. Create Delegation**
- Create new delegations from your current Ed25519 DID
- Delegate to another DID with specific capabilities
- **Delegation chaining supported** - create sub-delegations from received delegations
- Expiration support (1 hour to 10 years, or never)
- Works with both Storacha credentials and received delegations

### **7. Revoke Delegations** 🆕
- **Revoke delegations you created** to immediately block access
- Integrated with Storacha's revocation registry
- **Real-time validation** - all operations check revocation status before executing
- **Visual indicators** - Clear UI badges showing Active/Revoked/Expired status
- **Automatic caching** - Revocation checks are cached for 5 minutes to minimize API calls
- **Security first** - Essential for handling lost devices, mistakes, or security incidents
- **Permanent action** - Revocations cannot be undone (by design)
- Works with both issuer and audience of delegations

**How it works:**
1. Click "Revoke" button on any delegation you created
2. Confirm the action (cannot be undone)
3. Revocation request sent to Storacha service
4. Delegation marked as revoked in local storage
5. Recipient can no longer use the delegation for uploads
6. Revocation status synced via `https://up.storacha.network/revocations/`

## 🔄 How It Works

### Serverless Architecture
- **100% browser-based** - No backend server required
- **Client-side only** - All cryptography happens in browser/web worker
- **Deployed to IPFS** - Static files served from decentralized storage
- **WebAuthn + UCAN** - Hardware-backed identity + decentralized authorization

### Browser A (Delegation Creator)
1. **Authenticate** with WebAuthn → Generate Ed25519 DID
2. **Add Storacha credentials** (key + proof) OR import delegation from CLI/another browser
3. **Create delegation** for Browser B's DID with selected capabilities
4. **Share delegation proof** (base64 string) with Browser B

### Browser B (Delegation Receiver)  
1. **Authenticate** with WebAuthn → Generate own Ed25519 DID
2. **Import delegation proof** from Browser A
3. **Upload/list/delete files** using delegated permissions
4. **No Storacha credentials needed** - operates entirely through delegated authority!

### Multi-Browser Delegation Chain
```
Storacha Console → Browser A → Browser B → Browser C
                    (creates   (re-delegates
                    delegation) to Browser C)
```

Each browser can create sub-delegations from received delegations, enabling flexible permission management across devices and users.

## 📦 Setup

### Prerequisites
- Modern browser with WebAuthn support
- Device with biometric authentication
- Storacha account and credentials (for creating delegations)

### Installation
```bash
cd web
npm install
npm run dev
```

### First-Time Setup

**Option 1: Using Storacha CLI (Recommended for first browser)**
1. **Authenticate** - Click "Authenticate with Biometric"
2. **Get Your DID** - Copy your Ed25519 DID from the UI
3. **Create Delegation** - Use Storacha CLI:
   ```bash
   storacha delegation create <your-did> --base64
   ```
4. **Import Delegation** - Paste the delegation proof
5. **Upload Files** - Start uploading!

**Option 2: Browser-to-Browser Delegation (No Storacha account needed)**
1. **Browser A**: Add Storacha credentials or import CLI delegation
2. **Browser B**: Authenticate → Copy your Ed25519 DID
3. **Browser A**: Create delegation for Browser B's DID
4. **Browser A**: Share the delegation proof (copy/paste, QR code, etc.)
5. **Browser B**: Import delegation proof
6. **Browser B**: Upload files without Storacha account!

**Option 3: Direct Storacha Credentials (Advanced)**
1. **Authenticate** - Click "Authenticate with Biometric"
2. **Add Credentials** - Enter your Storacha private key, space proof, and space DID
3. **Upload Files** - Start uploading and creating delegations!

## 🔐 Security

> **⚠️ READ FIRST**: Please review **[SECURITY.md](./SECURITY.md)** for critical security warnings and attack vectors.

### 🚀 Future: Multi-Device DKG

A **planned version** will use **Distributed Key Generation (DKG)** across multiple devices (browser + mobile), where:
- No single device holds the complete private key
- Signing requires confirmation from multiple devices (e.g., scan QR code on mobile)
- Devices communicate via js-libp2p
- Hardware-backed security on all devices
- Enables secure credential storage on Storacha

See **[PLANNING.md](./PLANNING.md)** for the complete roadmap and technical details.

## 🛠️ Technical Details

### **Worker Keystore**
- Location: `web/src/workers/ed25519-keystore.worker.ts`
- Generates Ed25519 keypair using Web Crypto API
- Creates `@ucanto/principal/ed25519` compatible archive
- AES key derived deterministically from PRF seed

### **Secure Ed25519 DID**
- Location: `web/src/lib/secure-ed25519-did.ts`
- Wraps worker communication
- Provides `encryptArchive()` / `decryptArchive()` helpers
- Manages DID generation and storage

### **UCAN Delegation Service**
- Location: `web/src/lib/ucan-delegation.ts`
- Manages Storacha client initialization
- Handles delegation import/export
- Upload/list/delete operations

## 📝 Notes

- **Deterministic DID**: Same WebAuthn credential always produces same Ed25519 DID
- **Archive Encryption**: Archive encrypted with AES-GCM, decrypted only in worker
- **Delegation Mismatch**: If DID changes, delegation must be recreated
- **Worker Persistence**: Worker state lost on page reload; archive restored from localStorage
- **Delegation Chaining**: Can create sub-delegations from received delegations, enabling permission cascading across browsers/devices
- **Format Auto-Detection**: Uses ucanto `extract()` first (for app-created delegations), falls back to Storacha `Proof.parse()` (for CLI delegations), maintaining backward compatibility
- **Base64 Encoding Compatibility**: Handles both standard base64 (Storacha CLI) and base64url formats by detecting the multibase prefix ('m' or 'u') and normalizing accordingly. See [issue #590](https://github.com/storacha/upload-service/issues/590) for background on the encoding challenge.

## 🔗 Resources

### Standards & Specifications
- **[WebAuthn Level 3 (W3C)](https://www.w3.org/TR/webauthn-3/)** - Web Authentication API specification
  - [§6.5.5 Authentication Assertion](https://www.w3.org/TR/webauthn-3/#sctn-op-get-assertion) - Signature format details
  - [§6.5 CollectedClientData](https://www.w3.org/TR/webauthn-3/#dictdef-collectedclientdata) - Origin-bound data structure
- **[UCAN Specification](https://github.com/ucan-wg/spec)** - User Controlled Authorization Networks
- **[DID Key Method](https://w3c-ccg.github.io/did-method-key/)** - Decentralized Identifiers using public keys

### Documentation & Guides
- [Storacha Documentation](https://docs.storacha.network/) - Decentralized storage platform
- [WebAuthn Guide](https://webauthn.guide/) - Interactive WebAuthn tutorial

### Why WebAuthn Can't Sign UCANs

WebAuthn (both P-256 and Ed25519) cannot produce raw signatures suitable for UCAN tokens due to the signature format specification. WebAuthn signs `authenticatorData || hash(clientDataJSON)` which includes origin, ceremony type, and other metadata - making signatures non-portable and incompatible with UCAN's requirement for raw cryptographic signatures.

See **[SECURITY.md § WebAuthn UCAN Signing](./SECURITY.md#-webauthn-ucan-signing-why-its-not-possible)** for detailed technical explanation.

## 📚 Project Documentation

### Core Documents
- **[SECURITY.md](./SECURITY.md)** - Security warnings, attack vectors, and limitations
- **[PLANNING.md](./PLANNING.md)** - Future roadmap and planned features (5 phases)
- **[LICENSE](./LICENSE)** - MIT License

### Architecture & Flow Diagrams
- **[ARCHITECTURE_FLOW.md](./docs/ARCHITECTURE_FLOW.md)** - 🆕 Complete visual architecture with detailed Mermaid diagrams:
  - High-level system architecture
  - WebAuthn PRF authentication flow
  - Ed25519 keystore worker operations
  - DID generation (P-256 & Ed25519)
  - UCAN delegation creation & import
  - File upload with delegations
  - Revocation system
  - End-to-end multi-browser flow

### Technical Documentation (docs/)
- **[WEBAUTHN_PRF_IMPLEMENTATION.md](./docs/WEBAUTHN_PRF_IMPLEMENTATION.md)** - WebAuthn PRF extension implementation details
- **[KEYSTORE_ARCHITECTURE.md](./docs/KEYSTORE_ARCHITECTURE.md)** - Web worker-based Ed25519 keystore architecture
- **[SECURE_CREDENTIAL_STORAGE.md](./docs/SECURE_CREDENTIAL_STORAGE.md)** - largeBlob + Storacha architecture (Phase 1.5)
- **[REVOCATION_IMPLEMENTATION.md](./docs/REVOCATION_IMPLEMENTATION.md)** - UCAN revocation technical details (Phase 0)
- **[REVOCATION_QUICKSTART.md](./docs/REVOCATION_QUICKSTART.md)** - Revocation testing guide
- **[UX_IMPROVEMENT_AUTO_NAVIGATION.md](./docs/UX_IMPROVEMENT_AUTO_NAVIGATION.md)** - Auto-navigation UX improvement
- **[BUGFIX_DID_WEB_REVOCATION.md](./docs/BUGFIX_DID_WEB_REVOCATION.md)** - did:web support bug fixes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
