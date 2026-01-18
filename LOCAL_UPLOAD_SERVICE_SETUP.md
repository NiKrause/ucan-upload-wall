# Running Local Upload-Service with UCAN Upload Wall

This guide explains how to run a local HTTP upload-service instance and configure the ucan-upload-wall project to use it instead of production Storacha.

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Setting Up Local Upload Service](#setting-up-local-upload-service)
3. [Configuring UCAN Upload Wall](#configuring-ucan-upload-wall)
4. [Testing the Setup](#testing-the-setup)
5. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Production vs Local

**Production:**
```
ucan-upload-wall (browser)
    ↓ HTTPS
https://up.storacha.network (Cloudflare Workers)
    ↓
Storacha infrastructure (S3, DynamoDB, etc.)
```

**Local Development:**
```
ucan-upload-wall (browser)
    ↓ HTTP
http://localhost:8787 (Node.js HTTP server)
    ↓
In-memory stores (no external dependencies)
```

### Key Differences

| Aspect | Production | Local |
|--------|-----------|-------|
| Transport | HTTPS with real S3 | HTTP with in-memory storage |
| Authentication | Real credentials | Test credentials |
| Persistence | DynamoDB/S3 | RAM (lost on restart) |
| Revocations | Real registry | Mock registry |
| Content Claims | IPNI integration | Mock service |

---

## Setting Up Local Upload Service

### Step 1: Create HTTP Server Wrapper

Create a new file in the upload-service repository:

```bash
cd /Users/nandi/upload-service
```

Create `packages/upload-api/local-server.js`:

```javascript
#!/usr/bin/env node
import http from 'node:http'
import { createContext } from './src/test/helpers/context.js'
import { handle } from './src/lib.js'

/**
 * Local HTTP upload-service for development
 * This wraps the test context in an HTTP server
 */
async function startServer(port = 8787) {
  console.log('🔧 Initializing upload-service context...')
  
  // Create test context with all storage implementations
  const context = await createContext({
    requirePaymentPlan: false, // Disable payment checks for local dev
  })
  
  console.log('✅ Context initialized')
  console.log('🔑 Service DID:', context.id.did())
  console.log('📍 Service URL:', context.url.toString())
  
  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    // Log request
    console.log(`📥 ${req.method} ${req.url} from ${req.headers.origin || 'unknown'}`)
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }
    
    try {
      // Read request body
      const chunks = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      
      // Convert to UCANTO request format
      const request = {
        headers: req.headers,
        body,
      }
      
      // Handle with UCANTO server
      const response = await handle(context.connection.channel, request)
      
      // Send response with CORS headers
      const headers = {
        ...response.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
      
      res.writeHead(response.status || 200, headers)
      res.end(response.body)
      
      console.log(`✅ ${req.method} ${req.url} - ${response.status || 200}`)
      
    } catch (error) {
      console.error('❌ Request failed:', error)
      res.writeHead(500, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain',
      })
      res.end(`Server error: ${error.message}`)
    }
  })
  
  // Start server
  server.listen(port, () => {
    console.log('╔════════════════════════════════════════════╗')
    console.log('║  🚀 Local Upload-Service Running          ║')
    console.log('╚════════════════════════════════════════════╝')
    console.log(``)
    console.log(`📍 Server:     http://localhost:${port}`)
    console.log(`🔑 DID:        ${context.id.did()}`)
    console.log(``)
    console.log(`⚠️  In-memory storage - data will be lost on restart`)
    console.log(`✅ CORS enabled for all origins`)
    console.log(`🔓 Payment plan checks disabled`)
    console.log(``)
    console.log(`Press Ctrl+C to stop`)
  })
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...')
    server.close(() => {
      console.log('✅ Server closed')
      process.exit(0)
    })
  })
  
  return { server, context }
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 8787
  startServer(port).catch(console.error)
}

export { startServer }
```

### Step 2: Add Run Script

Add to `packages/upload-api/package.json`:

```json
{
  "scripts": {
    "local-server": "node local-server.js"
  }
}
```

### Step 3: Start Local Server

```bash
cd /Users/nandi/upload-service/packages/upload-api
pnpm local-server
```

You should see:

```
╔════════════════════════════════════════════╗
║  🚀 Local Upload-Service Running          ║
╚════════════════════════════════════════════╝

📍 Server:     http://localhost:8787
🔑 DID:        did:web:test.up.storacha.network

⚠️  In-memory storage - data will be lost on restart
✅ CORS enabled for all origins
🔓 Payment plan checks disabled

Press Ctrl+C to stop
```

**Important Notes:**
- Service runs on `http://localhost:8787` by default
- All data is in-memory (lost on restart)
- CORS is enabled for browser access
- Payment/billing checks are disabled
- Service DID is `did:web:test.up.storacha.network`

---

## Configuring UCAN Upload Wall

### Changes Needed

The ucan-upload-wall currently hardcodes production URLs in several places. We need to make them configurable.

### Step 1: Add Environment Configuration

Create `web/.env.local`:

```bash
# Local upload-service configuration
VITE_UPLOAD_SERVICE_URL=http://localhost:8787
VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network

# Use local revocation service (or disable for testing)
VITE_REVOCATION_SERVICE_URL=http://localhost:8787/revocations
```

For production (or create `web/.env.production`):

```bash
VITE_UPLOAD_SERVICE_URL=https://up.storacha.network
VITE_UPLOAD_SERVICE_DID=did:web:up.storacha.network
VITE_REVOCATION_SERVICE_URL=https://up.storacha.network/revocations
```

### Step 2: Update Client Configuration

Modify `web/src/lib/ucan-delegation.ts`:

**Add configuration at the top of the file:**

```typescript
// Service configuration from environment
const UPLOAD_SERVICE_URL = import.meta.env.VITE_UPLOAD_SERVICE_URL || 'https://up.storacha.network';
const UPLOAD_SERVICE_DID = import.meta.env.VITE_UPLOAD_SERVICE_DID || 'did:web:up.storacha.network';
const REVOCATION_SERVICE_URL = import.meta.env.VITE_REVOCATION_SERVICE_URL || 'https://up.storacha.network/revocations';

console.log('🔧 Service Configuration:');
console.log('  Upload URL:', UPLOAD_SERVICE_URL);
console.log('  Service DID:', UPLOAD_SERVICE_DID);
console.log('  Revocation URL:', REVOCATION_SERVICE_URL);
```

**Update Client Creation (around line 685):**

⚠️ **IMPORTANT**: `serviceConf` expects `ConnectionView` objects, not plain `{url, did}` objects!

First, add imports at the top of the file:
```typescript
import * as UcantoClient from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
```

Then add a helper function to create connections:
```typescript
/**
 * Create a connection to the service
 */
function createConnection(url: string, did: string) {
  return UcantoClient.connect({
    id: DID.parse(did),
    codec: CAR.outbound,
    channel: HTTP.open({
      url: new URL(url),
      method: 'POST',
      headers: {
        'X-Client': 'UCAN-Upload-Wall/1',
      },
    }),
  })
}
```

Then find this code:
```typescript
const client = await Client.create({
  principal,
  store,
  // ... other options
})
```

Replace with:
```typescript
// Create connection to service (reuse for all endpoints)
const connection = createConnection(UPLOAD_SERVICE_URL, UPLOAD_SERVICE_DID)

const client = await Client.create({
  principal,
  store,
  serviceConf: {
    access: connection,
    upload: connection,
    filecoin: connection,
    gateway: connection, // Optional, not needed for basic operations
  },
})
```

**Update Revocation Checks (around line 1929):**

Find:
```typescript
const response = await fetch(
  `https://up.storacha.network/revocations/${delegationCID}`,
```

Replace with:
```typescript
const response = await fetch(
  `${REVOCATION_SERVICE_URL}/${delegationCID}`,
```

**Update Revocation Invocation (around line 2028 & 2055):**

Find:
```typescript
const serviceID = Verifier.parse('did:web:up.storacha.network') as any;
```

Replace with:
```typescript
const serviceID = Verifier.parse(UPLOAD_SERVICE_DID) as any;
```

Find:
```typescript
channel: HTTP.open({
  url: new URL('https://up.storacha.network'),
```

Replace with:
```typescript
channel: HTTP.open({
  url: new URL(UPLOAD_SERVICE_URL),
```

### Step 3: Update Vite Configuration

Ensure `web/vite.config.ts` can read `.env.local`:

```typescript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    // ... rest of config
  }
})
```

### Step 4: Rebuild and Run

```bash
cd /Users/nandi/ucan-upload-wall/web

# Install dependencies (if needed)
npm install

# Run in development mode
npm run dev
```

The app will now connect to your local upload-service at `http://localhost:8787`!

---

## Testing the Setup

### Test 1: Generate Ed25519 DID

1. Open http://localhost:5173 (or your Vite dev server port)
2. Click "Authenticate with Biometric"
3. Complete WebAuthn ceremony
4. Verify Ed25519 DID is generated (format: `did:key:z6Mk...`)

**Check Local Server Logs:**
You should see authentication requests in the terminal running `local-server.js`

### Test 2: Create Test Delegation

Since you're using a local server, you need to create delegations manually.

**🎯 Quick Method: Use the Included Script**

We've included a ready-to-use script in the project:

```bash
cd /Users/nandi/ucan-upload-wall

# Run the delegation script with your DID from the UI
node test-local-delegation.js did:key:z6Mk...
```

The script will:
1. Connect to localhost:8787
2. Create a test space
3. Generate a delegation for your DID
4. Output the proof to copy/paste into UI

**Option A: Manual Node.js Script**

Or create your own `test-delegation.js`:

```javascript
import * as Client from '@storacha/client'
import { Signer } from '@storacha/client/principal/ed25519'
import * as UcantoClient from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
import { StoreMemory } from '@storacha/client/stores/memory'

// Create connection helper
function createConnection(url, did) {
  return UcantoClient.connect({
    id: DID.parse(did),
    codec: CAR.outbound,
    channel: HTTP.open({ url: new URL(url), method: 'POST' }),
  })
}

// Create principal and client
const principal = await Signer.generate()
const connection = createConnection('http://localhost:8787', 'did:web:test.up.storacha.network')

const client = await Client.create({
  principal,
  store: new StoreMemory(),
  serviceConf: {
    access: connection,
    upload: connection,
    filecoin: connection,
  },
})

// Create a space
const space = await client.createSpace('test-space', {
  skipGatewayAuthorization: true,
})
const auth = await space.createAuthorization(client)
await client.addSpace(auth)
await client.setCurrentSpace(space.did())

console.log('Space DID:', space.did())

// Delegate to your Ed25519 DID from the UI
const yourDID = 'did:key:z6Mk...' // Copy from UI
const delegation = await client.createDelegation(yourDID, [
  'space/blob/add',
  'upload/add',
  'upload/list',
])

// Export as base64
const proof = await delegation.archive()
console.log('Delegation proof:', Buffer.from(proof.ok).toString('base64'))
```

Run: `node test-delegation.js`

Copy the delegation proof and import it in the UI.

**Option B: Using Browser Console**

Same code as above, but paste into browser console on a page with the modules loaded.

### Test 3: Upload a File

1. Import the delegation from Test 2
2. Drag & drop a file
3. Click "Upload"
4. Verify upload succeeds

**Check Server Logs:**
```
📥 POST / from http://localhost:5173
✅ POST / - 200
```

### Test 4: List Uploads

1. Click "List Uploads" tab
2. Verify uploaded files appear

---

## Troubleshooting

### Issue: CORS Errors

**Symptom:**
```
Access to fetch at 'http://localhost:8787' from origin 'http://localhost:5173' has been blocked by CORS policy
```

**Solution:**
Ensure the local server includes CORS headers (already in the code above). If still failing, check browser console for specific CORS error.

### Issue: Connection Refused

**Symptom:**
```
Failed to fetch
net::ERR_CONNECTION_REFUSED
```

**Solution:**
1. Verify local server is running: `lsof -i :8787`
2. Check firewall isn't blocking localhost:8787
3. Ensure `.env.local` has correct URL: `http://localhost:8787` (not https)

### Issue: DID Mismatch

**Symptom:**
```
The delegation is for: did:web:up.storacha.network
But your current DID is: did:web:test.up.storacha.network
```

**Solution:**
This happens when delegation was created for production but you're using local service. You need to:
1. Create new delegation using local service DID
2. Or update local server to use `did:web:up.storacha.network` (not recommended)

### Issue: Data Lost on Restart

**Symptom:**
After restarting local server, all uploads are gone.

**Solution:**
This is expected behavior! The local server uses in-memory storage. For persistent storage:

1. Create a persistent storage adapter (beyond scope of this guide)
2. Or use the production service for real data
3. Or export/import delegations before restarting

### Issue: Service Worker Errors

**Symptom:**
```
Failed to register service worker
```

**Solution:**
Service workers require HTTPS in production but work on `localhost` for development. If you're accessing via IP address (e.g., `192.168.1.x`), use `localhost` instead.

### Issue: WebAuthn Not Working with Local Service

**Symptom:**
WebAuthn works but signing/uploading fails.

**Solution:**
WebAuthn itself works fine, but the issue might be:
1. **PRF Extension**: Not all authenticators support PRF. Check console for PRF errors.
2. **Worker Mode**: Ensure you're in "Worker Mode" not "Hardware Mode" when testing.
3. **Archive Encryption**: Clear localStorage and regenerate keys if archive is corrupted.

---

## Production Deployment Checklist

Before deploying changes to production:

- [ ] Revert to production URLs in `.env.production`
- [ ] Test with real Storacha service
- [ ] Ensure `.env.local` is not committed to git
- [ ] Update `.gitignore` to exclude `.env.local`
- [ ] Verify CORS works with production domain
- [ ] Test revocations against production registry
- [ ] Remove any debug logging that exposes secrets

---

## Advanced: Custom Storage Backends

If you need persistent local storage, you can replace the in-memory stores:

```javascript
// In local-server.js
import { S3BlobStorage } from './src/test/storage/blob-storage.js'
import { DynamoDBTable } from './src/test/storage/upload-table.js'

const context = await createContext({
  requirePaymentPlan: false,
  // Override storage implementations
  blobsStorage: new S3BlobStorage({
    endpoint: 'http://localhost:9000', // MinIO
    bucket: 'test-uploads',
  }),
  uploadTable: new DynamoDBTable({
    endpoint: 'http://localhost:8000', // DynamoDB Local
    tableName: 'test-uploads',
  }),
  // ... etc
})
```

This requires running local S3 (MinIO) and DynamoDB instances.

---

## Next Steps

1. **Add Tests**: Create automated tests that spin up local server
2. **Mock Revocations**: Implement in-memory revocation registry
3. **Docker Setup**: Containerize local server for easier setup
4. **Multi-Device**: Test delegation chains across multiple browser instances
5. **Production Parity**: Add more realistic storage backends

---

## Resources

- [Storacha Documentation](https://docs.storacha.network/)
- [UCANTO Specification](https://github.com/web3-storage/ucanto)
- [Upload Service Repository](https://github.com/storacha/upload-service)
- [UCAN Upload Wall Repository](https://github.com/NiKrause/ucan-upload-wall)

---

## Support

If you encounter issues:

1. Check server logs in terminal
2. Check browser console for errors
3. Verify environment variables are loaded
4. Ensure local server is running
5. Test with curl: `curl -X POST http://localhost:8787`

For bugs or questions, open an issue on the GitHub repository.
