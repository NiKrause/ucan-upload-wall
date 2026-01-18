# Local Upload-Service Troubleshooting

## Current Status - Final Findings

### ❌ Root Cause: Browser Client Limitation

**The `@storacha/client` v1.8.21 does NOT support custom service URLs in browser environments.**

Testing confirmed:
- ✅ `Client.create()` works WITHOUT `serviceConf`
- ❌ `Client.create()` fails WITH `serviceConf` → "Cannot read properties of undefined (reading 'url')"
- Tested multiple formats: URL objects, URL strings, conditional configuration
- **All attempts with serviceConf failed in the browser**

### Why serviceConf Doesn't Work

The `@storacha/client` library appears to have two different code paths:
1. **Node.js**: Supports `serviceConf` for custom service URLs (as shown in testing docs)
2. **Browser**: Does NOT support `serviceConf` - uses hardcoded production endpoints

The examples in `docs/UPLOAD_SERVICE_TESTING_GUIDE.md` that show `serviceConf` working are **Node.js only**.

### Current Working State ✅

The app now works with:
- ✅ Config loaded from `.env` (for future use)
- ✅ All `Client.create()` calls use production service
- ✅ Space management works
- ✅ File uploads work (to production)
- ✅ WebAuthn Ed25519 signatures work
- ⚠️  **Local service connection NOT possible via @storacha/client**

## Next Steps for Varsig Support

Your local upload-service needs to be configured to accept WebAuthn varsig signatures. The varsig format includes:
- WebAuthn authenticator data
- Client data JSON
- Signature

The signature is embedded within a larger structure that's 241 bytes instead of the raw 64-byte Ed25519 signature.

### Option 1: Update Local Service
Configure your local upload-service to support varsig format. This likely involves:
1. Updating the signature verification logic
2. Extracting the Ed25519 signature from the varsig structure
3. Validating the WebAuthn assertion data

### Option 2: Test Without Varsig
For testing the local service connection, you could temporarily:
1. Use a regular Ed25519 key (not WebAuthn-backed)
2. Import a delegation created with a standard Ed25519 key
3. This would produce the expected 64-byte signature

### Option 3: Check Service Logs
Look at your local upload-service logs to see exactly what it's receiving and what it expects. This will help identify if varsig support is the only missing piece.

## Investigation Steps

### Test 1: Basic Client Creation
Try creating the client without any custom configuration:
```typescript
const client = await Client.create({
  principal,
  store,
});
```

**Status:** Testing now - will show if the issue is with serviceConf or something else

### Possible Root Causes

1. **Browser Client Limitation**
   - `@storacha/client` v1.8.21 might not support custom service URLs in browser environments
   - The examples in testing docs might be Node.js-only

2. **HTTP vs HTTPS**
   - Production uses HTTPS (`https://up.storacha.network`)
   - Local uses HTTP (`http://localhost:8787`)
   - Client might require HTTPS

3. **Service Discovery/Validation**
   - Client might try to validate the service on creation
   - Local service might not respond to discovery endpoints

4. **Type/Format Mismatch**
   - TypeScript types expect `ConnectionView<Service>` objects
   - Runtime might actually need different format than documentation suggests

## ✅ SOLUTION: Use @ucanto/client Directly for Local Service

The revocation feature already demonstrates this working! Here's how to connect to local service:

### Working Example (from existing code)

```typescript
import * as UcantoClient from '@ucanto/client';
import { CAR, HTTP } from '@ucanto/transport';
import { Verifier } from '@ucanto/principal';

// Parse the service DID
const serviceID = Verifier.parse(config.uploadService.did);

// Create connection to local service
const connection = UcantoClient.connect({
  id: serviceID,
  codec: CAR.outbound,
  channel: HTTP.open({
    url: new URL(config.uploadService.url),  // http://localhost:8787
    method: 'POST',
  }),
});

// Execute UCAN invocations directly
const invocation = await invoke({
  issuer,
  audience: serviceID,
  capability: {
    can: 'upload/list',
    with: spaceDid,
  },
  proofs: [delegation],
});

const results = await connection.execute(invocation);
```

### Implementation Plan

To fully support local service for uploads:

1. **Keep @storacha/client for production** (current state)
2. **Add @ucanto/client path for local service**:
   - Detect when `config.uploadService.url` is not production
   - Create UCAN invocations manually using `@ucanto/core`
   - Execute via `@ucanto/client` connection
   - This is exactly what we do for revocations!

3. **Capabilities needed**:
   - `space/blob/add` - Upload data blobs
   - `upload/add` - Register uploads
   - `upload/list` - List uploads
   - `upload/remove` - Delete uploads

This approach gives full control and works with any service URL!

### Option B: Proxy Through Production
Keep using production Storacha but configure your local service as a proxy or test endpoint.

### Option C: Mock Service Layer
Create a service layer that intercepts Storacha client calls and redirects to local service.

### Option D: Check Client Source Code
Look at `@storacha/client` source to see how it actually handles serviceConf.

## Next Steps

1. **Wait for test results** - See if basic client creation works
2. **If it works without serviceConf**:
   - Research correct serviceConf format for v1.8.21
   - Check if version upgrade needed
   - Look at client source code

3. **If it fails without serviceConf too**:
   - The issue is more fundamental
   - Consider using @ucanto/client directly (Option A)
   - Check browser console for network requests
   - Look for CORS or connection errors

4. **Verify local service**:
   - Test with curl: `curl http://localhost:8787/`
   - Check if it responds to expected endpoints
   - Verify CORS headers

## Commands to Test

```bash
# Test if local service responds
curl -v http://localhost:8787/

# Check what endpoints it has
curl -v http://localhost:8787/version

# Test CORS
curl -v -H "Origin: http://localhost:5173" http://localhost:8787/
```

## Current Code State

All `Client.create()` calls temporarily simplified to:
```typescript
const client = await Client.create({
  principal,
  store,
});
```

This removes `serviceConf` to isolate the issue. Once we understand the root cause, we can add proper configuration.
