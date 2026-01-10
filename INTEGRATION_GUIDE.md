# Integration Guide: Hardware-Backed UCAN Signing

## Overview

This guide explains how to integrate the new hardware-backed WebAuthn Ed25519 signing with the existing UCAN delegation system.

## Architecture Comparison

### Current (Worker-Based)
```
WebAuthn P-256 → PRF → AES → Ed25519 Worker → Software Signing
     ↑                             ↑
  Hardware                    Vulnerable
```

### New (Hardware-Backed)
```
WebAuthn Ed25519 → Varsig Encoding → Hardware Signing
        ↑                    ↑
   Hardware              No extraction possible
```

## Usage

### 1. Initialize Hardware Signer

```typescript
import { HardwareUCANDelegationService } from '@/lib/hardware-ucan-service';

const hardwareService = new HardwareUCANDelegationService();

// Check support
const supported = await hardwareService.checkHardwareSupport();
if (!supported) {
  console.log('Falling back to worker-based signing');
  // Use existing UCANDelegationService
}

// Initialize (creates credential or loads existing)
const initialized = await hardwareService.initializeHardwareSigner(
  'user@example.com',
  'Alice'
);

if (initialized) {
  const did = hardwareService.getHardwareDID();
  console.log('Hardware DID:', did);
}
```

### 2. Create Delegation with Hardware Signer

```typescript
// Create delegation (biometric required!)
const proof = await hardwareService.createHardwareDelegation(
  'did:key:z6Mk...', // target DID
  'did:key:z6Mk...', // space DID
  ['upload/add', 'store/add'], // capabilities
  24 // expiration hours
);

// Share proof with recipient
console.log('Delegation proof:', proof);
```

### 3. Verify Hardware-Backed Delegation

```typescript
const result = await hardwareService.verifyHardwareDelegation(
  proof,
  'https://your-app.com' // expected origin
);

if (result.valid) {
  console.log('✅ Valid hardware-backed delegation');
  console.log('Issuer:', result.issuerDid);
  console.log('Audience:', result.audienceDid);
} else {
  console.error('❌ Invalid:', result.error);
}
```

## Integration with Existing Service

### Option 1: Feature Flag (Recommended)

Add a feature flag to UCANDelegationService:

```typescript
class UCANDelegationService {
  private hardwareService: HardwareUCANDelegationService | null = null;
  private useHardwareSigning = false;
  
  async initialize() {
    // Try hardware first
    this.hardwareService = new HardwareUCANDelegationService();
    const supported = await this.hardwareService.checkHardwareSupport();
    
    if (supported) {
      const initialized = await this.hardwareService.initializeHardwareSigner();
      this.useHardwareSigning = initialized;
    }
    
    if (!this.useHardwareSigning) {
      // Fall back to worker-based approach
      await this.initializeWorkerBased();
    }
  }
  
  async createDelegation(...args) {
    if (this.useHardwareSigning && this.hardwareService) {
      return await this.hardwareService.createHardwareDelegation(...args);
    } else {
      return await this.createWorkerDelegation(...args);
    }
  }
}
```

### Option 2: Separate Service (Current Implementation)

Keep services separate and let users choose:

```typescript
// In Setup component or similar
const [signingMethod, setSigningMethod] = useState<'hardware' | 'worker'>('hardware');

async function setupSigning() {
  if (signingMethod === 'hardware') {
    const service = new HardwareUCANDelegationService();
    const supported = await service.checkHardwareSupport();
    
    if (!supported) {
      alert('Hardware signing not supported, falling back to worker');
      setSigningMethod('worker');
    } else {
      await service.initializeHardwareSigner();
      // Use hardware service
    }
  } else {
    // Use existing UCANDelegationService
  }
}
```

## Browser Support

| Browser | Ed25519 Support | Status |
|---------|----------------|--------|
| Chrome 108+ | ✅ | Full support |
| Safari 17+ (macOS 14+) | ✅ | Full support |
| Safari 17+ (iOS 17+) | ✅ | Full support |
| Firefox | ⚠️ | Platform dependent |
| Edge 108+ | ✅ | Full support |

### Detection

```typescript
const supported = await checkEd25519Support();
if (!supported) {
  // Use worker-based fallback
}
```

## Security Benefits

### Hardware-Backed (New)
- ✅ Keys **never** leave secure hardware
- ✅ Biometric required **per signature**
- ✅ XSS cannot extract keys
- ✅ No localStorage vulnerability
- ✅ Memory dumping useless

### Worker-Based (Current)
- ❌ Keys in worker memory
- ❌ Single biometric for PRF
- ❌ XSS can extract keys
- ❌ localStorage has encrypted archive
- ❌ Memory dumping possible

## UX Considerations

### Hardware Signing
- ⚠️ Biometric prompt for **every** delegation creation
- ✅ Users expect this for sensitive operations
- ✅ Same UX as Apple Pay, password managers

### Worker Signing
- ✅ One biometric prompt on login
- ⚠️ Less secure but more convenient

## Migration Path

### For New Users
1. Check hardware support
2. If supported → use hardware signing
3. If not → fall back to worker signing

### For Existing Users
1. Keep worker-based credentials working
2. Add option to "upgrade" to hardware signing
3. Clearly explain security benefits

### Implementation

```typescript
async function setupUser() {
  // Check for existing worker credentials
  const hasWorkerCreds = localStorage.getItem('ed25519_archive_encrypted');
  
  // Check hardware support
  const hardwareSupported = await checkEd25519Support();
  
  if (!hasWorkerCreds && hardwareSupported) {
    // New user with hardware support - use hardware
    return 'hardware';
  } else if (hasWorkerCreds && hardwareSupported) {
    // Existing user - offer upgrade
    const upgrade = await confirmUpgrade();
    return upgrade ? 'hardware' : 'worker';
  } else {
    // No hardware support - use worker
    return 'worker';
  }
}
```

## Testing

### Unit Tests
```bash
npm test  # Tests varsig encoding/decoding
```

### E2E Tests (TODO)
```typescript
test('create hardware delegation', async ({ page }) => {
  // Use Playwright virtual authenticator
  await page.addInitScript(() => {
    // Mock WebAuthn
  });
  
  // Test credential creation
  // Test delegation creation
  // Test delegation verification
});
```

## Next Steps

1. ✅ Core varsig implementation
2. ✅ Hardware signer class
3. ✅ Integration service
4. ⏳ Add to Setup component
5. ⏳ Add to DelegationManager
6. ⏳ E2E tests
7. ⏳ Documentation
8. ⏳ Migration guide

## Files

- `web/src/lib/webauthn-varsig/` - Core varsig implementation
- `web/src/lib/webauthn-ed25519-signer.ts` - Hardware signer
- `web/src/lib/hardware-ucan-service.ts` - Integration service
- `web/src/lib/ucan-delegation.ts` - Existing service (unchanged)

## Questions?

See:
- `web/src/lib/webauthn-varsig/README.md` - Varsig documentation
- `SECURITY.md` - Security analysis
- `IMPLEMENTATION_SUMMARY.md` - Implementation status
