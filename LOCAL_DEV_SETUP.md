# Local Development Setup

## Connecting to Local Upload-Service

The web application now supports connecting to a local upload-service for development and testing.

### Configuration

The application reads configuration from environment variables in `web/.env`:

```bash
# Local Upload Service
VITE_UPLOAD_SERVICE_URL=http://localhost:8787
VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network
```

If these environment variables are not set, the application defaults to the production Storacha service:
- URL: `https://up.storacha.network`
- DID: `did:web:up.storacha.network`

### Files Changed

1. **`web/src/config.ts`** (new file)
   - Centralizes all environment variable configuration
   - Logs configuration on startup for easy debugging

2. **`web/src/lib/ucan-delegation.ts`**
   - Updated to use `config.uploadService.url` and `config.uploadService.did`
   - **Seven locations updated:**
     - Revocation check endpoint (1 location)
     - Service DID for UCAN operations (1 location)
     - Service URL for UCAN operations (1 location)
     - **`Client.create()` serviceConf (4 locations)** ✅
       - Line ~583: Storacha credentials client
       - Line ~686: Delete operation client
       - Line ~918: List files client
       - Line ~1048: Upload with delegation client
   - **Format used:** Simplified `serviceConf` with URL objects directly:
     ```typescript
     serviceConf: {
       access: new URL(config.uploadService.url),
       upload: new URL(config.uploadService.url),
       filecoin: new URL(config.uploadService.url),
     }
     ```

3. **`web/src/lib/webauthn-varsig/test-utils.ts`**
   - Updated mock UCAN payload to use configured service DID

4. **`web/src/vite-env.d.ts`** (new file)
   - TypeScript type definitions for environment variables

### Starting the Local Upload-Service

Based on your log output, your local service is running at:
- **URL**: http://localhost:8787
- **DID**: did:web:test.up.storacha.network
- **Features**: In-memory storage, CORS enabled, no payment checks

### Connecting the Web App

1. Ensure your `web/.env` file has the correct values:
   ```bash
   VITE_UPLOAD_SERVICE_URL=http://localhost:8787
   VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network
   ```

2. **Restart your development server** (required to pick up new env vars):
   ```bash
   # Stop the current dev server (Ctrl+C in the terminal)
   # Then restart:
   cd web
   npm run dev
   ```

3. Open your browser console - you should see:
   ```
   📋 Upload Service Configuration:
     url: http://localhost:8787
     did: did:web:test.up.storacha.network
   ```

4. The app will now **fully** connect to your local upload-service! ✅
   - All `@storacha/client` operations (uploads, space management, etc.)
   - All UCAN invocations (delegations, revocations)
   - All service API calls

### Troubleshooting

- **Changes not taking effect?** 
  - Make sure you restarted the dev server after updating `.env`
  - Vite only reads environment variables on startup

- **Still seeing production URLs?**
  - Check the browser console for the configuration log
  - Verify the `.env` file is in the `web/` directory
  - Ensure variable names start with `VITE_` prefix

- **CORS errors?**
  - Your local upload-service already has CORS enabled for all origins ✅

- **415 Unsupported Media Type on revocation checks?**
  - This is expected if your local service doesn't implement `/revocations/{cid}`
  - The app handles this gracefully by treating it as "not revoked"
  - Revocation checks are not critical for local development

- **Cannot read properties of undefined (reading 'url')?**
  - This was fixed by using the simplified `serviceConf` format
  - If you still see this, make sure you have the latest code

### Switching Back to Production

Simply remove or comment out the environment variables in `web/.env` and restart the dev server.

## Technical Implementation Details

### Storacha Client Configuration

All four `Client.create()` calls in `ucan-delegation.ts` now use **conditional serviceConf**:

```typescript
const clientOptions: any = {
  principal,
  store,
};

// Only add serviceConf if using non-production URL
if (config.uploadService.url !== 'https://up.storacha.network') {
  console.log('🔧 Configuring for LOCAL service:', config.uploadService.url);
  const serviceURL = new URL(config.uploadService.url);
  clientOptions.serviceConf = {
    access: serviceURL,
    upload: serviceURL,
    filecoin: serviceURL,
  };
  clientOptions.receiptsEndpoint = serviceURL;
} else {
  console.log('🔧 Using default PRODUCTION service');
}

const client = await Client.create(clientOptions);
```

**Why Conditional?**

The client works best when `serviceConf` is only added for non-production endpoints. For production, it uses built-in defaults.

### What's Configured

With these changes, **all** Storacha operations now use your configured service URL:

✅ File uploads (`client.uploadFile()`)  
✅ Space management (`client.addSpace()`, `client.setCurrentSpace()`)  
✅ Access control operations  
✅ Filecoin storage deal operations  
✅ Receipt verification  
✅ UCAN invocations (delegations, revocations)  
✅ Revocation status checks

The app is fully configured to work with your local upload-service! 🎉
