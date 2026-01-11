# UI Algorithm Display Fix

## Problem

The UI was showing "Ed25519" hardcoded in the hardware mode banner, even when the system was actually using P-256:

```
Hardware-Backed Security Active
Your browser supports hardware-backed WebAuthn Ed25519 signing!
```

This was confusing because most hardware authenticators use P-256, not Ed25519.

## Solution

Updated the UI to **dynamically display the actual algorithm** being used by querying the hardware signer.

## Changes Made

### 1. **Added `getHardwareAlgorithm()` method to `HardwareUCANDelegationService`**

```typescript
// web/src/lib/hardware-ucan-service.ts

/**
 * Get hardware signer algorithm
 */
getHardwareAlgorithm(): 'Ed25519' | 'P-256' | null {
  return this.hardwareSigner?.algorithm || null;
}
```

### 2. **Updated `getSigningMode()` to include algorithm**

```typescript
// web/src/lib/ucan-delegation.ts

getSigningMode(): { 
  mode: 'hardware' | 'worker'; 
  did: string | null; 
  secure: boolean;
  algorithm?: 'Ed25519' | 'P-256';  // NEW!
}
```

### 3. **Updated App.tsx to display the correct algorithm**

```tsx
// web/src/App.tsx

<p className="text-sm text-green-800">
  Your browser supports <strong>hardware-backed WebAuthn {signingMode.algorithm || 'Ed25519'}</strong> signing! 
  Your private keys are stored in secure hardware (TPM/Secure Enclave) and <strong>cannot be extracted</strong> by malicious extensions or XSS attacks.
  <strong className="block mt-1">✅ Biometric authentication is required for each UCAN signature.</strong>
  {signingMode.algorithm === 'P-256' && (
    <span className="block mt-1 text-green-700">
      ℹ️ Using P-256 with ucanto fork (Ed25519 not supported by this hardware).
    </span>
  )}
</p>
```

### 4. **Updated Setup.tsx to show algorithm in title**

```tsx
// web/src/components/Setup.tsx

<h3 className="text-sm font-semibold mb-1 text-green-900">
  🔐 Hardware-Backed Security Active ({signingMode.algorithm || 'Ed25519'})
</h3>

// Plus additional info in the bullet list:
{signingMode.algorithm === 'P-256' && (
  <li className="text-green-700 font-medium">
    • Using P-256 with ucanto fork (Ed25519 not available on this hardware)
  </li>
)}
```

## Result

### For P-256 Hardware (Most Common)

**App.tsx banner:**
```
🔐 Hardware-Backed Security Active

Your browser supports hardware-backed WebAuthn P-256 signing! 
Your private keys are stored in secure hardware (TPM/Secure Enclave) 
and cannot be extracted by malicious extensions or XSS attacks.

✅ Biometric authentication is required for each UCAN signature.

ℹ️ Using P-256 with ucanto fork (Ed25519 not supported by this hardware).
```

**Setup.tsx title:**
```
🔐 Hardware-Backed Security Active (P-256)
```

### For Ed25519 Hardware (Rare - Future Devices)

**App.tsx banner:**
```
🔐 Hardware-Backed Security Active

Your browser supports hardware-backed WebAuthn Ed25519 signing! 
Your private keys are stored in secure hardware (TPM/Secure Enclave) 
and cannot be extracted by malicious extensions or XSS attacks.

✅ Biometric authentication is required for each UCAN signature.
```

**Setup.tsx title:**
```
🔐 Hardware-Backed Security Active (Ed25519)
```

## Benefits

✅ **Accurate information** - Users see the actual algorithm being used  
✅ **Educational** - Users learn that P-256 is being used as a fallback  
✅ **Transparency** - Clear indication that ucanto fork is needed for P-256  
✅ **Future-proof** - Will correctly display Ed25519 when hardware supports it  

## Files Modified

- `web/src/lib/hardware-ucan-service.ts` - Added `getHardwareAlgorithm()` method
- `web/src/lib/ucan-delegation.ts` - Updated `getSigningMode()` to return algorithm
- `web/src/App.tsx` - Dynamic algorithm display with P-256 notice
- `web/src/components/Setup.tsx` - Algorithm in title and bullet points

## Testing

1. Clear localStorage
2. Create new credential with Touch ID or Security Key
3. Check the UI banner - should show "P-256" (on most devices)
4. Check Setup page - title should show "Hardware-Backed Security Active (P-256)"
5. Additional info line should appear explaining ucanto fork usage
