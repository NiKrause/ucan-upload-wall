# Native Ed25519 WebAuthn - Experimental Branch

This branch contains experimental support for **native Ed25519 WebAuthn credentials** without worker-based UCAN signing.

## ⚠️ Important Limitations

### What Works
- ✅ Creating hardware-backed Ed25519 WebAuthn credentials
- ✅ Displaying Ed25519 DID in UI
- ✅ Biometric authentication
- ✅ Hardware security for the Ed25519 key

### What Doesn't Work
- ❌ **Creating UCAN delegations** - WebAuthn keys cannot sign arbitrary UCAN data
- ❌ **Using UCAN delegations** - Requires signing operations that WebAuthn doesn't support
- ❌ **Uploading files** - Requires UCAN signatures
- ❌ **Any Storacha operations** - All require UCAN signing

## Why These Limitations Exist

WebAuthn keys are designed for **authentication challenges only**. The WebAuthn API does not allow signing arbitrary data (like UCAN delegations) for security reasons. This is a fundamental limitation of the WebAuthn specification, not a bug in our implementation.

## Current State

In this branch:
- Native Ed25519 credential creation is **ENABLED**
- The app will try to create an Ed25519 key directly from WebAuthn
- If successful, you'll see "Hardware-Backed" badge in the UI
- Delegation creation UI is **HIDDEN** for native Ed25519 users

## Use Cases

This branch is useful for:
- 🔬 Experimenting with native Ed25519 WebAuthn support
- 📊 Testing browser compatibility with Ed25519 algorithm
- 🎓 Educational purposes to understand WebAuthn limitations
- 🔮 Future-proofing when WebAuthn may support arbitrary data signing

## Production Branch

For full UCAN functionality, use the **main branch** which uses:
```
P-256 WebAuthn → PRF Seed → Worker-based Ed25519 → Full UCAN Support
```

This approach provides:
- ✅ Full delegation creation and usage
- ✅ File uploads via Storacha
- ✅ UCAN signing operations
- ✅ Complete workflow functionality

## Technical Details

### How It Works (in this branch)

1. **Credential Creation**: Tries Ed25519 algorithm (`alg: -8`) first
2. **Fallback**: If Ed25519 fails, falls back to P-256 with PRF
3. **DID Generation**: Creates proper Ed25519 DID from public key
4. **UI Updates**: Shows key type and limitations

### Code Changes

- `webauthn-did.ts`: Added `tryCreateNativeEd25519()` method
- `webauthn-did.ts`: Added `createEd25519DID()` for DID generation
- `Setup.tsx`: Display key algorithm and hardware-backed badge
- `DelegationManager.tsx`: Hide delegation UI for native Ed25519

## Future Possibilities

If WebAuthn spec is extended to support signing arbitrary data:
- This code will be ready to use immediately
- Just need to add UCAN signing support
- Hardware-backed Ed25519 could provide true security

Until then, this remains an experimental feature for exploration.

---

**Created**: January 5, 2026  
**Status**: Experimental  
**Branch**: `feature/native-ed25519-webauthn`

