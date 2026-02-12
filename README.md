# 🔐 UCAN Upload Wall

[![CI (main)](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ci.yml?query=branch%3Amain)
[![CI (dev)](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ci.yml?query=branch%3Adev)

> **⚠️ SECURITY WARNING**: This code has **NOT been security audited** and should **NOT be used in production**. See **[SECURITY.md](./SECURITY.md)** for critical security considerations, attack vectors, and limitations.

A browser-only file upload application powered by **hardware-backed WebAuthn Ed25519 + varsig v1**, with a **worker-based Ed25519 fallback**, and **UCAN delegations** on Storacha.

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
- [🔗 Related Projects](#-related-projects)
- [📄 License](#-license)

## 🌐 Live Demo

**[Try it now →](https://dweb.link/ipfs/bafybeic6mefgeb7yrzdzytxlxxg5vngzosv7qxx4svogtmevon2rif2izm)**

⚠️ **Demo is for testing only** - do not use with valuable data (see security warnings above)

## 📸 Delegation Flow Screenshots (GitHub Pages)

Fixed, step-by-step screenshots from CI are published here:

**[https://nikrause.github.io/ucan-upload-wall/](https://nikrause.github.io/ucan-upload-wall/)**

## 🌐 IPFS Network Flow (3 Modes)

The two-browser IPFS verification flow now runs as a separate 3-job workflow (Worker, Hardware Ed25519, Hardware P-256):

**[IPFS Network Flow workflow](https://github.com/NiKrause/ucan-upload-wall/actions/workflows/ipfs-network-flow.yml)**

Each push publishes a bundled artifact in a separate directory layout (`ipfs-network-flow/`) via the artifact:

- `ipfs-network-flow-published`

**To mitigate the above stated security risks**, please use the browser app only in:

- Browsers **without any installed browser extensions** (e.g., Chrome extensions), or
- **Mobile phones** where the attack surface is much smaller

## 🎥 Demo Video

[![UCAN Upload Wall Demo](https://img.youtube.com/vi/3ZqkgYMS1MM/hqdefault.jpg)](https://www.youtube.com/watch?v=3ZqkgYMS1MM)

*Click the image above to watch the demo video on YouTube*

## 🏗️ Architecture

> **📊 For detailed visual diagrams and flow charts, see [ARCHITECTURE_FLOW.md](./docs/ARCHITECTURE_FLOW.md)**  
> Includes sequence diagrams for WebAuthn, Ed25519 keystore, delegation flows, and complete end-to-end scenarios with Mermaid visualizations.

### **WebAuthn Ed25519 + Varsig v1 (Hardware Mode)**
- Hardware-secured signing using device biometrics (Face ID, Touch ID, Windows Hello)
- Ed25519 keys stored in secure hardware (TPM/Secure Enclave)
- Varsig v1 wrapper preserves WebAuthn assertion format for UCAN compatibility
- Used for: UCAN signing when hardware Ed25519 is available
- **Note**: Hardware P-256 is not supported yet (see [SECURITY.md](./SECURITY.md))

### **Worker-Based Ed25519 Keystore (Fallback)**
- Ed25519 keypair generated in a dedicated web worker
- AES-GCM encryption key derived from WebAuthn PRF seed (deterministic)
- Private key never leaves the worker (see Security warnings)
- DID format: `did:key:z6Mk...` (Ed25519 public key)
- Used for: UCAN signing, Storacha client principal when hardware Ed25519 is unavailable

**Worker Functions:**
- `init(prfSeed)` - Initialize AES key from WebAuthn PRF seed
- `generateKeypair()` - Generate Ed25519 keypair and archive
- `encrypt(plaintext)` - Encrypt data with AES-GCM
- `decrypt(ciphertext, iv)` - Decrypt data with AES-GCM
- `sign(data)` - Sign data with Ed25519 private key
- `verify(data, signature)` - Verify Ed25519 signature

### **Key Flow**
```
WebAuthn Credential (Ed25519, hardware if supported)
    ↓
rawCredentialId (PRF seed if falling back)
    ↓
Worker: HKDF-SHA-256 → AES-GCM key
    ↓
Worker: Generate Ed25519 keypair
    ↓
Worker: Create Ed25519Signer archive
    ↓
Encrypt archive with AES key → localStorage
    ↓
Reconstruct Ed25519Signer for Storacha client (fallback mode)
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

### Local In-Memory Storacha (3 terminals)
Use this when you want the local upload service + Helia preview flow. The
`storacha:memory` output includes a Helia multiaddr you should pass to the app.

**Terminal 1: local upload API + Helia**
```bash
npm run storacha:memory
```

**Terminal 2: web app pointed at local API**
```bash
VITE_UPLOAD_SERVICE_URL=http://127.0.0.1:8787 \
VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network \
VITE_REVOCATION_URL=http://127.0.0.1:8787 \
VITE_HELIA_ADDRS=/ip4/127.0.0.1/tcp/PORT/ws/p2p/PEER_ID \
npm run dev:local
```

**Terminal 3: create a delegation (CLI or helper script)**
```bash
cd web
node scripts/test-local-delegation.js
```

Then paste the delegation proof into the app.
For more detail, see `docs/local-dev.md` (setup) and `docs/LOCAL_STORACHA_STATUS.md`
(status, Helia notes, troubleshooting).

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

### Why Varsig v1 Is Required

WebAuthn signs `authenticatorData || hash(clientDataJSON)`, which is origin-bound and structured. Varsig v1 wraps the WebAuthn assertion with explicit signature metadata and payload encoding so UCAN tooling can transport and verify it without changing WebAuthn security properties.

See **[SECURITY.md](./SECURITY.md)** and **[docs/varsig-implementation.md](./docs/varsig-implementation.md)** for details.

## 📚 Project Documentation

### Core Documents
- **[SECURITY.md](./SECURITY.md)** - Security warnings, attack vectors, and limitations
- **[PLANNING.md](./PLANNING.md)** - Future roadmap and planned features (5 phases)
- **[INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)** - Hardware-backed signing integration notes
- **[docs/local-dev.md](./docs/local-dev.md)** - Local upload-service setup and troubleshooting
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
- **[varsig-branch-notes.md](./docs/varsig-branch-notes.md)** - Branch-specific varsig notes and tests
- **[varsig-implementation.md](./docs/varsig-implementation.md)** - Varsig v1 WebAuthn implementation details
- **[ChainAgnostic varsig README](https://github.com/ChainAgnostic/varsig/blob/main/README.md)** - Upstream varsig spec reference

## 🔗 Related Projects

### Passkey Storage & WebAuthn Extensions

#### **[Lighthouse Passkey Demo](https://www.lighthouse.storage/blogs/Passkey%20Demo%20App%20with%20WebAuthn%20and%20Ethereum)**
- Demo app combining WebAuthn passkeys with Ethereum and Lighthouse storage
- Shows integration of biometric authentication with decentralized storage
- **Potential Integration**: Investigate Lighthouse SDK compatibility with our modular signer architecture (`@ucan-upload-wall/signer-interface`)
- Could enable multi-storage backend support (Storacha + Lighthouse)

#### **[Nydia Passkey Holder](https://github.com/NiKrause/Nydia-Passkey-Holder)**
- Browser extension that emulates a hardware wallet by injecting into the WebAuthn API
- Enables decentralized passkey storage on the Sia network
- **Planned Enhancement**: Fork and upgrade to support Storacha UCANs
- Could serve as a bridge between traditional WebAuthn apps and UCAN delegation systems
- Potential to integrate with our `@ucan-upload-wall/signer-webauthn` package

### Secret Sharing & Encryption

#### **[SecretShare](https://github.com/Nkovaturient/SecretShare)**
- Securely delegate time-limited, usage-bound access to secrets (API keys, credentials, vault notes) via UCANs
- Currently uses Lit Protocol for encryption
- **Research Opportunity**: Investigate replacing Lit Protocol with WebAuthn hardware-protected keys + PRF extension
- Could leverage our worker-based Ed25519 keystore architecture for deterministic encryption keys
- Potential integration path:
  1. Use `@ucan-upload-wall/signer-webauthn` for PRF-derived encryption keys
  2. Replace Lit Protocol's key management with WebAuthn PRF + worker-based key derivation
  3. Maintain UCAN-based delegation for access control
  4. Benefits: Hardware-backed security without external key management service

## Credits

- https://github.com/expede for hints on Bluesky
- https://github.com/hugomrdias for quick introduction to varsig
- https://github.com/Fatumayattani for the original idea
- https://github.com/Patrick-Ehimen for finishing E2E tests
- https://github.com/Nkovaturient for general support

### Integration Roadmap

These projects share common goals around decentralized identity, hardware-backed security, and UCAN authorization. Our modular architecture (see monorepo design above) is specifically designed to support:

- **Pluggable Signers**: Easy to add Lighthouse-specific or Nydia-compatible signers
- **Storage Backends**: Abstract storage interface allows Lighthouse, Sia, or Storacha
- **Encryption Providers**: PRF-based key derivation can replace centralized services like Lit Protocol
- **UCAN Compatibility**: Shared delegation format enables cross-project interoperability

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
