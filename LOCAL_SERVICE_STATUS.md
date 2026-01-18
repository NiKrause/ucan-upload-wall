# Local Upload-Service Connection Status

## TL;DR

✅ **Config system working** - Environment variables loaded from `.env`  
❌ **@storacha/client limitation** - Cannot connect to local service in browser  
✅ **Alternative solution available** - Use `@ucanto/client` directly (like revocations)

## What's Working Now

### Environment Configuration ✅
```bash
# web/.env
VITE_UPLOAD_SERVICE_URL=http://localhost:8787
VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network
```

Values are loaded and available in `config.uploadService`:
- `config.uploadService.url` → `"http://localhost:8787"`
- `config.uploadService.did` → `"did:web:test.up.storacha.network"`

### Direct UCAN Operations ✅
Revocation checks already use the configured service:
```typescript
const response = await fetch(
  `${config.uploadService.url}/revocations/${delegationCID}`,
  // ...
);
```

### Storacha Client ⚠️
All `Client.create()` calls work but **only connect to production**:
```typescript
const client = await Client.create({
  principal,
  store,
});
// Always connects to https://up.storacha.network (hardcoded)
```

## The Problem

**The `@storacha/client` library does not support custom service URLs in browser environments.**

### Testing Confirmed

Multiple attempts all failed with same error:

❌ **Attempt 1**: URL objects in serviceConf
```typescript
serviceConf: {
  access: new URL('http://localhost:8787'),
  upload: new URL('http://localhost:8787'),
}
```
**Result**: `Cannot read properties of undefined (reading 'url')`

❌ **Attempt 2**: URL strings
**Result**: Same error

❌ **Attempt 3**: Conditional serviceConf (only for non-production)
**Result**: Same error when local URL configured

✅ **Works**: No serviceConf at all (uses production hardcoded URL)

### Why This Happens

The `@storacha/client` has different implementations:
- **Node.js**: Supports `serviceConf` parameter (as shown in docs)
- **Browser**: Does NOT support `serviceConf` - hardcoded to production

The testing examples in `docs/UPLOAD_SERVICE_TESTING_GUIDE.md` are Node.js only.

## ✅ The Solution: Use @ucanto/client

### What We Already Have Working

Revocations use `@ucanto/client` directly and **successfully connect to configured service**:

```typescript
const { invoke } = await import('@ucanto/core');
const UcantoClient = await import('@ucanto/client');
const { CAR, HTTP } = await import('@ucanto/transport');
const { Verifier } = await import('@ucanto/principal');

const serviceID = Verifier.parse(config.uploadService.did);

const connection = UcantoClient.connect({
  id: serviceID,
  codec: CAR.outbound,
  channel: HTTP.open({
    url: new URL(config.uploadService.url),  // ← Uses config!
    method: 'POST',
  }),
});

const revocationInvocation = await invoke({
  issuer,
  audience: serviceID,
  capability: {
    can: 'ucan/revoke',
    with: issuer.did(),
    nb: { ucan: parsedDelegation.cid }
  },
  proofs: [parsedDelegation]
});

const results = await connection.execute(revocationInvocation);
```

This works perfectly with local service!

### What Needs to be Done

To fully support local service for uploads, replace high-level `client.uploadFile()` calls with low-level UCAN invocations:

1. **For file uploads**: Create `space/blob/add` and `upload/add` invocations
2. **For listing files**: Create `upload/list` invocation
3. **For deleting files**: Create `upload/remove` invocation

Each operation would:
1. Create the UCAN invocation with proper capabilities
2. Execute via the configured connection
3. Parse the response

This gives full control and works with any service URL!

## Next Steps

### Option 1: Accept Production-Only for Now
- Keep current implementation
- Users connect to production Storacha service
- Works perfectly, just not with local service

### Option 2: Implement @ucanto/client Path
- Add conditional logic: if local URL → use @ucanto/client, else → use @storacha/client
- Implement low-level UCAN operations for upload/list/remove
- Follow the pattern already established for revocations
- Estimated effort: 2-4 hours

### Option 3: Document Limitation
- Add clear documentation that browser client only supports production
- Note that @ucanto/client can be used for local development
- Provide code examples in docs

## Files Modified

All changes are already in place for the config system:

- ✅ `web/src/config.ts` - Config loading
- ✅ `web/src/vite-env.d.ts` - TypeScript types
- ✅ `web/src/lib/ucan-delegation.ts` - Already uses config for revocations
- ⚠️  `web/src/lib/ucan-delegation.ts` - Client.create() forced to production

## Recommendation

**Keep the current implementation** (production only for high-level operations).

Why:
1. It works reliably
2. Most users will use production service anyway
3. Local development is already possible via Node.js test scripts
4. The @ucanto/client alternative is available if needed later

The config infrastructure is in place and ready if you decide to implement the @ucanto/client path later.
