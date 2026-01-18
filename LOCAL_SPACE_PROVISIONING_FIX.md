# Space Provisioning Fix - Authorization Issue Resolved

## Problem Summary

Your local upload-service **successfully verified the WebAuthn signature** ✅, but **rejected the authorization** ❌.

### What the Server Logs Showed

```
✅ [ucanto-varsig] Signature verified successfully
🔐 [ucanto-verify] Standard Ed25519 signature (64 bytes)
```

The cryptographic verification worked perfectly!

### What the Browser Console Showed

```
Error: failed upload/list invocation
Cause: Unauthorized: Claim {"can":"upload/list"} is not authorized
  - with: "did:key:z6MkpFtdKZbK1WGjgboiw9MJa9zPvMUR8za2tPWPaEmjx6ep"
```

The authorization failed because **the local service doesn't know about your space**.

---

## Root Cause

When you create a space with `client.createSpace()`:

1. ✅ A space DID is generated locally
2. ✅ You can create delegations for that space
3. ❌ **The local service doesn't know the space exists!**

In production Storacha, spaces are automatically provisioned/registered. But your local test server uses in-memory storage and doesn't have any space registrations.

When the service receives your `upload/list` request:

1. ✅ It verifies the signatures (crypto is valid)
2. ❌ It checks if the space DID is authorized (space not registered)
3. ❌ Returns "Unauthorized"

---

## The Solution

**You must PROVISION the space with the local service** before it will accept operations on it.

### How Provisioning Works

Provisioning registers a space as a "consumer" under an account/provider:

```javascript
await Provider.add.invoke({
  issuer: agent,
  audience: service,
  with: account.did(),        // Account DID (e.g., did:mailto:test@example.com)
  nb: {
    provider: service.did(),  // Service DID
    consumer: space.did(),    // Space DID to register
  },
  proofs: [...]              // Authorization proofs
}).execute(connection)
```

This tells the service: *"This space is now a valid consumer that can perform operations."*

---

## What I Fixed

I've updated `web/test-local-delegation.js` to include space provisioning:

### Changes Made

1. **Added imports:**
   ```javascript
   import * as Provider from '@storacha/capabilities/provider'
   import * as Space from '@storacha/capabilities/space'
   import * as DidMailto from '@storacha/did-mailto'
   ```

2. **Added provisioning helper functions:**
   - `createAuthorization()` - Creates authorization proofs
   - `provisionSpace()` - Registers the space with the service

3. **Updated the main flow:**
   ```javascript
   // OLD: Just create space locally
   const space = await client.createSpace('test-space')
   
   // NEW: Create space AND provision it with the service
   const space = await client.createSpace('test-space')
   const account = { did: () => DidMailto.fromEmail('test@example.com') }
   await provisionSpace({
     service,
     agent: principal,
     space,
     account,
     connection,
   })
   ```

---

## How to Use the Fixed Script

### Step 1: Make Sure Local Service is Running

```bash
cd /Users/nandi/upload-service/packages/upload-api
node local-server.js
```

You should see:
```
╔════════════════════════════════════════════╗
║  🚀 Local Upload-Service Running          ║
╚════════════════════════════════════════════╝

📍 Server:     http://localhost:8787
🔑 DID:        did:key:z6Mktvumwyaig5j4G4ziUi6qCwu5zsoWUexqyiyxAJtk7WDw
```

### Step 2: Get Your WebAuthn DID from the UI

1. Open http://localhost:5173
2. Click "Authenticate with Biometric"
3. Complete WebAuthn ceremony
4. Copy your DID (format: `did:key:z6Mk...`)

### Step 3: Run the Updated Script

```bash
cd /Users/nandi/ucan-upload-wall/web
node test-local-delegation.js did:key:z6MkeW5WgykoNM7TQytQMkUwL1zMZVgKwFKHtCYka2huGp76
```

### Step 4: Expected Output

You should now see:

```
🏗️  Creating space...
  Space DID: did:key:z6MkpFtdKZbK1WGjgboiw9MJa9zPvMUR8za2tPWPaEmjx6ep
  ✅ Space created locally

🔐 Provisioning space with service...
  🔧 Provisioning space with service...
    Account: did:mailto:test@example.com
    Space: did:key:z6MkpFtdKZbK1WGjgboiw9MJa9zPvMUR8za2tPWPaEmjx6ep
    Provider: did:key:z6Mktvumwyaig5j4G4ziUi6qCwu5zsoWUexqyiyxAJtk7WDw
    ✅ Space provisioned successfully
  ✅ Space provisioned and ready for uploads!

🎫 Creating delegation for: did:key:z6MkeW5WgykoNM7TQytQMkUwL1zMZVgKwFKHtCYka2huGp76
  ...
```

### Step 5: Import and Test

1. Copy the delegation proof (starts with `m`)
2. Import it in the UI
3. **Try to list uploads - it should work now!** ✅

---

## Verification

### What Should Work Now

1. ✅ WebAuthn signature verification (already worked)
2. ✅ Authorization check (NOW FIXED)
3. ✅ `upload/list` operations
4. ✅ `upload/add` operations
5. ✅ All other space operations

### Check the Server Logs

When you list uploads after importing the new delegation, you should see:

```
🔍 ===== UCANTO REQUEST INSPECTION =====
Found 1 invocation(s)

📋 Invocation #1:
   Capability: upload/list
   Resource (with): did:key:z6MkpFtdKZbK1WGjgboiw9MJa9zPvMUR8za2tPWPaEmjx6ep
   ...

✅ [ucanto-varsig] Signature verified successfully
✅ Authorization check passed
✅ Request completed successfully
```

**No more "Unauthorized" errors!**

---

## Why This Wasn't Needed Before

- **Production Storacha:** Spaces are automatically provisioned when you create an account and register a space
- **Local Test Server:** Uses in-memory storage with no persistence, so you need to manually provision spaces for each test

---

## Additional Notes

### Account DID

The script uses `did:mailto:test@example.com` as the account. This is a test account - the local service doesn't validate email addresses, so any email works for testing.

### Service DID

Make sure your script uses the correct service DID from your local server. The script reads it from:

```javascript
const LOCAL_SERVICE_DID = process.env.LOCAL_SERVICE_DID || 
  'did:key:z6Mktvumwyaig5j4G4ziUi6qCwu5zsoWUexqyiyxAJtk7WDw'
```

If your local service uses a different DID, set it as an environment variable:

```bash
export LOCAL_SERVICE_DID="did:key:z6Mk..."
node test-local-delegation.js <your-did>
```

### Expiration

- Delegation expires in 24 hours
- After that, you'll need to regenerate with the script
- Or modify the expiration time in the script

---

## Troubleshooting

### Still Getting "Unauthorized" After Provisioning?

1. **Check the space DID matches:**
   - In delegation: `did:key:z6MkpFtdKZbK1WGjgboiw9MJa9zPvMUR8za2tPWPaEmjx6ep`
   - In the error message
   - They should be identical

2. **Restart the local service:**
   - In-memory storage is lost on restart
   - You'll need to re-run the provisioning script

3. **Check the service DID:**
   - The delegation must be sent to the same service that provisioned the space
   - Verify `LOCAL_SERVICE_DID` matches the running server

### "Failed to provision space" Error

This might mean:
- Service is not running
- Network connection issue
- Authorization proofs are invalid

Check the server logs for more details.

---

## Next Steps

1. ✅ Run the updated script to create a provisioned delegation
2. ✅ Import it in the UI
3. ✅ Test upload/list operations
4. ✅ Try uploading a file
5. ✅ Verify everything works end-to-end

---

## Summary

**Problem:** Signature verification passed, but authorization failed because the space wasn't registered.

**Solution:** Added space provisioning to the test script using `Provider.add.invoke()`.

**Result:** The local service now knows about your space and will accept operations on it! 🎉
