# Testing Ledger Ed25519 with WebAuthn

## Changes Made

Modified `webauthn-ed25519-signer.ts` to allow **external authenticators** (USB security keys) in addition to platform authenticators.

### Before
```typescript
authenticatorSelection: {
  authenticatorAttachment: 'platform',  // Only Touch ID, Windows Hello, etc.
  userVerification: 'required',
  residentKey: 'preferred'
}
```

### After
```typescript
authenticatorSelection: {
  // Removed 'platform' requirement to allow external authenticators
  // authenticatorAttachment: 'platform',
  userVerification: 'preferred',  // More permissive
  residentKey: 'preferred'
}
```

## What This Enables

**Now the browser will show:**
- 🔒 **Platform authenticators** (Touch ID, Windows Hello, Face ID)
- 🔑 **External authenticators** (USB/NFC security keys)

Previously, USB devices like Ledger and YubiKey were blocked.

## Testing Steps

### Prerequisites
1. **Ledger device** (Nano S, Nano X, or Nano S Plus)
2. **USB cable** connected to Mac
3. **Ledger unlocked** with PIN entered
4. **FIDO2 app** installed on Ledger (if required)
5. **Clear browser data** to force new credential creation

### Test Procedure

1. **Clear Previous Credentials**
   ```javascript
   // In browser console:
   localStorage.clear();
   location.reload();
   ```

2. **Connect Ledger**
   - Plug in Ledger via USB
   - Unlock with PIN
   - Keep on home screen or FIDO2 app

3. **Click "Create Ed25519 DID"**
   - Browser should show authenticator selection
   - Should see both Touch ID AND USB security key options
   - **Choose the USB security key / Ledger option**

4. **Watch Console Logs**
   
   **If Ed25519 works (🎉 SUCCESS):**
   ```
   ✅ WebAuthn credential created
      Authenticator Type: 🔑 Cross-platform (USB Security Key)
   🔍 Authenticator returned COSE key: {kty: 1, ktyName: "OKP", alg: -8, algName: "EdDSA", crv: 6, crvName: "Ed25519"}
   ✅ Successfully extracted Ed25519 public key (32 bytes)
   🎉 HARDWARE ED25519 MODE ACTIVATED!
      Keys are stored in secure hardware and cannot be extracted
      Biometric authentication required for each signature
   ✅ Created WebAuthn Ed25519 credential
      DID: did:key:z6Mk...
      Authenticator: External security key (USB/NFC)
   ```

   **If only P-256 works (expected):**
   ```
   ✅ WebAuthn credential created
      Authenticator Type: 🔑 Cross-platform (USB Security Key)
   🔍 Authenticator returned COSE key: {kty: 2, ktyName: "EC2", alg: -7, algName: "ES256", crv: 1, crvName: "P-256"}
   ⚠️ Authenticator used EC2 (P-256) instead of OKP (Ed25519)
   💡 This authenticator does not support Ed25519.
   ⚠️ Hardware initialization failed, falling back to worker mode
   ```

## What We're Testing

### Hypothesis
Ledger devices support Ed25519 cryptographically, and may expose it via FIDO2/WebAuthn when used as an external authenticator.

### Expected Results

**Scenario A: Ledger Supports Ed25519 for WebAuthn** 🎯
- Console shows `ktyName: "OKP"`, `algName: "EdDSA"`, `crvName: "Ed25519"`
- Hardware mode activates
- Ledger button press required for each signature
- Keys never leave the Ledger device

**Scenario B: Ledger Only Supports P-256 for WebAuthn** (more likely)
- Console shows `ktyName: "EC2"`, `algName: "ES256"`, `crvName: "P-256"`
- Falls back to worker mode
- Worker generates Ed25519 for UCAN signing
- WebAuthn (P-256) used only for authentication/PRF

**Scenario C: Ledger Not Recognized**
- Browser doesn't show USB security key option
- Only Touch ID appears
- May need FIDO2 app open on Ledger
- May need different browser

## Comparison with Other Devices

| Device | Connection | Expected Ed25519 |
|--------|-----------|------------------|
| Touch ID (Intel Mac) | Platform | ❌ P-256 (tested) |
| Touch ID (Apple Silicon) | Platform | ❓ Unknown |
| Windows Hello (TPM 2.0) | Platform | ❓ Maybe |
| Ledger Nano S/X/Plus | USB | ❓ **Testing now** |
| YubiKey 5 Series | USB/NFC | ✅ Likely (per docs) |

## Troubleshooting

### Browser Doesn't Show USB Option
- Ensure Ledger is unlocked
- Try opening FIDO2 app on Ledger
- Try Chrome instead of Safari
- Check USB connection

### Ledger Shows Error
- Make sure firmware is updated
- Ensure FIDO2 app is installed
- Try different browser
- Check Ledger Live for updates

### Touch ID Still Appears First
- That's normal - browser shows all available authenticators
- Make sure to **select the USB/security key option**
- Don't use Touch ID for this test

## Why This Matters

**If Ledger supports Ed25519 for WebAuthn:**
- 🎉 We get true hardware-backed Ed25519 UCAN signing
- 🔒 Keys never leave the Ledger device
- ✅ Strongest possible security model
- 🚀 No worker needed, no encrypted storage needed

**If Ledger only supports P-256:**
- ✅ Worker mode still works great
- 🔐 PRF provides good security
- 📝 We document realistic limitations
- 🎯 Set accurate expectations

## Expected Timeline

**Test Duration:** 5-10 minutes
**Results:** Immediate (check console logs)

## Additional Tests

If you have access to:
- **YubiKey 5** → Should support Ed25519
- **Apple Silicon Mac** → Test platform authenticator
- **Windows 11 22H2+ PC** → Test Windows Hello

## Documentation Updates

Based on test results, we'll update:
1. `HARDWARE_MODE_DIAGNOSTICS.md` - Add real test results
2. `webauthn-ed25519-signer.ts` comments - Clarify what works
3. `INTEGRATION_GUIDE.md` - Set realistic expectations

## Questions to Answer

1. ✅ Does Ledger show up as an option? 
2. ✅ Does it create a credential successfully?
3. 🎯 Does it return OKP (Ed25519) or EC2 (P-256)?
4. 📊 What's the exact COSE key output?

Let's find out! 🔍
