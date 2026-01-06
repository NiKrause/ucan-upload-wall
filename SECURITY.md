# ⚠️ SECURITY WARNING

## 🚨 Critical Notice: Not Production Ready

**THIS CODE HAS NOT UNDERGONE A SECURITY AUDIT AND SHOULD NOT BE USED IN PRODUCTION ENVIRONMENTS.**

This project is an experimental proof-of-concept for WebAuthn-based UCAN delegations. It has not been reviewed by security professionals and may contain critical vulnerabilities. Use at your own risk for testing and educational purposes only.

---

## 🔓 Web Worker Security Vulnerabilities

### Attack Surface

While Web Workers provide some isolation from the main thread, they are **not a secure execution environment** and should not be relied upon for protecting sensitive cryptographic material.

### Known Attack Vectors

#### 1. **Code Injection Attacks**

Any malicious code injected into your application (via XSS, supply chain attacks, browser extensions, or compromised dependencies) can:

- **Read Worker Memory**: Access the worker's global scope and extract secrets
- **Intercept Messages**: Monitor `postMessage()` communication between main thread and worker
- **Monkey-Patch APIs**: Override `crypto.subtle`, `postMessage`, or other worker APIs to exfiltrate keys
- **Timing Attacks**: Measure execution time to infer information about private keys

**Example Attack:**
```javascript
// Malicious code injected into main thread or worker
const originalPostMessage = Worker.prototype.postMessage;
Worker.prototype.postMessage = function(msg) {
  console.log('Intercepted:', msg); // Exfiltrate secrets
  sendToAttacker(msg);
  return originalPostMessage.apply(this, arguments);
};
```

#### 2. **localStorage Vulnerabilities**

The encrypted Ed25519 archive is stored in `localStorage`, which is accessible to:
- Any JavaScript running in the same origin
- Browser extensions with appropriate permissions

**Even with encryption**, an attacker who can inject code can:
- Wait for the decryption key to be used
- Intercept the decrypted archive during operation
- Capture the PRF seed when WebAuthn authentication occurs

#### 3. **Memory Dumping**

An attacker with sufficient privileges (e.g., via browser vulnerability, malicious extension) could:
- Dump worker memory to extract private keys
- Access the AES-GCM encryption key while it's in use
- Read plaintext secrets during cryptographic operations

#### 4. **Supply Chain Attacks**

Dependencies used in workers (`@ucanto/principal`, `@noble/hashes`, etc.) could be compromised:
- Malicious package updates
- Typosquatting attacks
- Compromised maintainer accounts

### References

For more information on Web Worker security limitations:
- [MDN: Web Workers Security](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#security)
- [Web Worker XSS Attack Vectors](https://portswigger.net/web-security/cross-site-scripting/contexts/web-workers)
- [Content Security Policy and Workers](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP#workers)

---

## 🛡️ Recommended Secure Architecture: Hardware-Backed WebAuthn Keys

### The Ideal Approach

The **most secure architecture** for this application would be to exclusively use **hardware-backed WebAuthn keys** (P-256 or Ed25519), where:

✅ **Private keys never leave hardware**  
✅ **Signing operations performed in secure enclaves** (TPM, Secure Element, Trusted Execution Environment)  
✅ **No key material exposed to JavaScript**  
✅ **Biometric authentication required for each operation**  
✅ **No encrypted keystores in localStorage**  

### Why Hardware-Backed WebAuthn is Superior

| Feature | Current (Ed25519 + Worker) | Ideal (WebAuthn Hardware Keys) |
|---------|---------------------------|--------------------------|
| **Private Key Exposure** | ❌ Exists in worker memory | ✅ Never leaves hardware |
| **Attack Surface** | ❌ Large (JS injection, worker compromise) | ✅ Minimal (hardware isolation) |
| **Storage Security** | ❌ Encrypted in localStorage | ✅ No storage needed |
| **Signature Operations** | ❌ In JavaScript/WASM | ✅ In secure hardware |
| **Key Extraction** | ❌ Possible with code injection | ✅ Cryptographically impossible |
| **Biometric Gate** | ❌ One-time (for PRF seed) | ✅ Per-operation |

### Architecture Comparison

**Current Implementation (Insecure):**
```
WebAuthn (P-256) → PRF Seed → Worker AES Key → Decrypt Ed25519 Key → Sign in JS
      ↑                                                   ↑
   Hardware Secure                                   Software (Vulnerable)
```

**Ideal Implementation (If Possible):**
```
WebAuthn (P-256 or Ed25519) → Sign UCAN → Done
      ↑
   Hardware Secure (End-to-End)
```

However, this ideal implementation **is not possible** with current web standards (see next section).

---

## 🚧 Current Limitation: WebAuthn Signature Format Incompatibility

### Why P-256 Support Doesn't Solve This

While P-256 signature **verification** support has been explored (see [experimental fork](https://github.com/NiKrause/ucanto/tree/p256)), adding P-256 to ucanto/Storacha **does not solve the core WebAuthn signature format problem**:

- ❌ Still requires **raw** signatures (not WebAuthn-wrapped)
- ❌ Does not enable hardware-backed WebAuthn signing
- ❌ Application must still use software-based key generation
- ❌ Worker security vulnerability remains

**Reality Check**: P-256 and Ed25519 are both affected equally by the WebAuthn signature format incompatibility. Using P-256 instead of Ed25519 would **not** improve security - both would still require software-based keys in web workers.

---

## 🔐 WebAuthn UCAN Signing: Why It's Not Possible

### The WebAuthn Signature Format Problem

**WebAuthn supports both P-256 (ES256) and Ed25519 (EdDSA) algorithms**, but **neither can be used for UCAN signing** due to the WebAuthn signature format.

> **Note**: Ed25519 (EdDSA) support in WebAuthn was added in the [WebAuthn Level 3 specification](https://www.w3.org/TR/webauthn-3/) finalized in 2025. Browser and hardware support is still rolling out. However, **even with Ed25519 support, the WebAuthn signature format limitation remains** - you still cannot produce raw Ed25519 signatures for UCAN signing.

According to the **[W3C WebAuthn Level 3 Specification](https://www.w3.org/TR/webauthn-3/)**, WebAuthn doesn't sign arbitrary data directly. Instead, it creates signatures over a specific structure (§6.5.5):

```
signature = sign(authenticatorData || sha256(clientDataJSON))
```

Where `clientDataJSON` wraps your data (§6.5):
```json
{
  "type": "webauthn.get",
  "challenge": "base64url(yourData)",
  "origin": "https://your-domain.com",
  "crossOrigin": false
}
```

**This is fundamentally incompatible with what UCAN requires:**
```
signature = sign(rawUcanPayloadBytes)
```

This limitation applies **equally to P-256 AND Ed25519** keys in WebAuthn - the problem is not the cryptographic algorithm, but the signature format specification.

### The Missing Piece

To achieve true hardware-backed UCAN signing, we would need:

1. **Raw signature capability** (not WebAuthn-wrapped) - **Missing**
2. **Hardware-backed keys** (TPM/Secure Enclave) - **✅ Available via WebAuthn**
3. **Both simultaneously** ← This is what WebAuthn doesn't provide today

WebAuthn provides #2 but not #1. You can have hardware security **OR** raw UCAN-compatible signatures, but not both with current web standards.

This limitation applies equally to:
- ❌ WebAuthn P-256 keys
- ❌ WebAuthn Ed25519 keys  
- ❌ WebCrypto API P-256 keys (not hardware-backed)
- ❌ WebCrypto API Ed25519 keys (not hardware-backed)

### Why the Current Architecture Exists

The Ed25519-in-worker approach is a **pragmatic compromise** given the constraints:

1. **WebAuthn Limitation**: Neither P-256 nor Ed25519 keys in WebAuthn can produce raw signatures for UCAN
2. **UCAN Ecosystem**: Expects standard signature formats (raw ECDSA/EdDSA), not WebAuthn-wrapped assertions
3. **Storacha Requirement**: Only accepts Ed25519 signatures
4. **Browser-Only Goal**: Must work entirely in browser without native applications
5. **Immediate Functionality**: Requires working signatures today, not in 2-5 years

This architectural limitation is **not a design flaw** but rather **the reality of current web cryptography standards**.

### WebAuthn Specification References

The signature format limitation is defined in:

- **[WebAuthn Level 3 § 6.5.5](https://www.w3.org/TR/webauthn-3/#sctn-op-get-assertion)** - Generating an Authentication Assertion
- **[WebAuthn Level 3 § 6.5](https://www.w3.org/TR/webauthn-3/#dictdef-collectedclientdata)** - CollectedClientData Structure

Key points from the specification:

> "Let signature be the assertion signature of the concatenation `authenticatorData || hash`..."

Where `hash = SHA-256(UTF-8 encoding of clientDataJSON)`, and `clientDataJSON` is origin-bound.

This means:
- ❌ Signatures cannot be verified independently of the web origin
- ❌ Signatures include ceremony type (`webauthn.get` vs `webauthn.create`)
- ❌ Data is double-hashed (challenge → clientDataJSON → SHA-256 → signed)
- ❌ No "raw signing mode" exists in WebAuthn Level 3

### Future Possibilities

True hardware-backed UCAN signing would require **one of these approaches**:

1. **WebAuthn Extension** for raw signing (not proposed for Level 3+)
2. **New Web Standard** for hardware-backed cryptographic operations
3. **Platform-specific APIs** (Apple CryptoKit, Windows CNG) outside the browser
4. **Native applications** with direct hardware access (defeats browser-only goal)
5. **Custom UCAN Verifier** accepting WebAuthn signature format (breaks ecosystem compatibility)

**Timeline**: Any web standard solution is likely 2-5 years away, if it happens at all.

**Workaround Used**: Generate Ed25519 keys in software (web worker), derive encryption key from WebAuthn PRF, encrypt and store keys. This provides WebAuthn-gated access to Ed25519 keys but **does not** provide hardware-backed key security.

---

## 🔮 Future Solution: Multi-Device Distributed Key Generation

While the WebAuthn signature format limitation cannot be solved with current standards, there is a **long-term solution** that eliminates the web worker security vulnerability entirely: **Distributed Key Generation (DKG)** with threshold cryptography.

### The Concept

Instead of storing a complete Ed25519 key on a single device (vulnerable to extraction), **split the key across multiple devices**:

```
Device 1 (Browser)     Device 2 (Mobile)
      ↓                       ↓
  Key Share 1            Key Share 2
  (hardware-backed)      (hardware-backed)
      ↓                       ↓
      └─────────┬─────────────┘
                ↓
         Combined Signature
         (BOTH devices required)
```

### How It Solves the Security Problem

**Key Security Benefits:**

- ✅ **No complete key on any device** - compromising one device doesn't expose the private key
- ✅ **Multi-device authentication** - requires biometric approval on both devices for signing
- ✅ **Hardware-backed shares** - each key share protected by WebAuthn on its device
- ✅ **No key material in JavaScript** - only combined during threshold signing protocol
- ✅ **Eliminates worker vulnerability** - no complete key exists in web worker memory

**Attack Mitigation:**

| Attack Vector | Current (Ed25519 in Worker) | DKG (Multi-Device) |
|--------------|----------------------------|-------------------|
| Code Injection | ❌ Can steal complete key | ✅ Only gets one share (useless alone) |
| Worker Compromise | ❌ Full key exposed | ✅ Incomplete key share |
| Lost/Stolen Device | ❌ Full key compromised | ✅ Requires both devices |
| Memory Dumping | ❌ Can extract full key | ✅ Only partial key share |

### Implementation Status

This is a **Phase 2 long-term goal** (12-24 months). For full technical details including:
- Threshold signature protocols (FROST)
- Device communication (js-libp2p)
- QR code signing flow
- Cross-device authentication

See **[Phase 2 in PLANNING.md](./PLANNING.md#phase-2-multi-device-dkg-architecture-long-term)**.

---

## 🔒 Mitigation Strategies (Current Architecture)

While the current architecture is insecure, the following measures reduce (but do not eliminate) risk:

### 0. Use in Restricted Environments

**Most Important**: To significantly reduce the attack surface:

- ✅ **Use in browsers WITHOUT any extensions** (e.g., Chrome/Firefox with zero extensions installed)
- ✅ **Use on mobile phones** where browser extensions are typically not available and the attack surface is much smaller
- ❌ **Avoid using with browser extensions installed** - they can inject code, intercept messages, and access localStorage

This single measure eliminates many of the code injection attack vectors described in this document.

### 1. Content Security Policy (CSP)
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self'; 
               worker-src 'self'; 
               connect-src 'self' https://up.storacha.network;">
```

### 2. Subresource Integrity (SRI)
Use SRI tags for all external scripts:
```html
<script src="..." integrity="sha384-..." crossorigin="anonymous"></script>
```

### 3. Dependency Pinning
Lock all dependencies to specific versions and audit regularly:
```bash
npm audit
npm audit fix
```

### 4. Short-Lived Sessions
- Clear worker memory after operations
- Re-authenticate frequently
- Don't persist decrypted keys

### 5. User Education
Warn users that:
- This is not production-grade security
- Private keys may be exposed to malicious code
- Only use for testing with non-critical data

---

## 📋 Security Checklist

Before using this application, ensure:

- [ ] You understand that **private keys can be extracted** by malicious code
- [ ] You are **not storing valuable or sensitive data**
- [ ] You have reviewed all dependencies for security issues
- [ ] You are running in an **isolated testing environment**
- [ ] You have a **Content Security Policy** configured
- [ ] You are **not using this in production**
- [ ] You understand that **localStorage is not secure storage**
- [ ] You accept the **risks of software-based key management**

---

## 🤝 Contributing

Want to help make this architecture secure? Here's how:

1. **Research DKG**: Investigate threshold signature schemes (FROST, GG20) for multi-device security
2. **Secure Storage**: Help implement Phase 1 (largeBlob + Storacha credential storage)
3. **Review Code**: Help audit cryptographic implementations
4. **Documentation**: Improve security documentation and best practices
5. **Roadmap**: See [PLANNING.md](./PLANNING.md) for detailed features and priorities

---

## 📞 Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do NOT open a public issue**
2. Email security concerns to the maintainer
3. Provide detailed reproduction steps
4. Allow time for patches before public disclosure

---

## 🚀 Future Plans

For detailed roadmap and future planning, including secure credential storage and multi-device DKG architecture, see:

**[PLANNING.md](./PLANNING.md) - Future Planning & Roadmap**

---

## ⚖️ Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

**USE AT YOUR OWN RISK.**
