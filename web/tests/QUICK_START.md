# Quick Start: Delegation Flow E2E Test

## 🎯 What Was Created

A comprehensive end-to-end test that validates the complete UCAN delegation and upload workflow by:

1. ✅ Creating an in-memory Storacha upload service (no external dependencies!)
2. ✅ Creating a space and provisioning it  
3. ✅ Creating a DID in the React UI using WebAuthn
4. ✅ Creating a delegation from the space to the browser DID (in base64 format)
5. ✅ Importing the delegation into the UI
6. ✅ Uploading a file using the delegation
7. ✅ Reloading the page and verifying files persist

## 🚀 Running the Test

### Prerequisites

Make sure dependencies are installed:
```bash
cd /Users/nandi/ucan-upload-wall/web
npm install
```

### Start the Dev Server

In one terminal:
```bash
cd /Users/nandi/ucan-upload-wall/web
npm run dev
```

### Run the Test

In another terminal:
```bash
cd /Users/nandi/ucan-upload-wall/web
npm run test:e2e -- delegation-upload-flow
```

### Run with Visible Browser (Recommended First Time)

To see what's happening:
```bash
npm run test:e2e:headed -- delegation-upload-flow
```

### Debug Mode

To step through the test:
```bash
npm run test:e2e:debug -- delegation-upload-flow
```

## 📁 Files Created/Modified

### New Files
- `web/tests/delegation-upload-flow.spec.ts` - Main E2E test file
- `web/tests/DELEGATION_FLOW_TEST_GUIDE.md` - Detailed guide
- `web/tests/QUICK_START.md` - This file

### Modified Files
- `web/package.json` - Added test dependencies
- `web/tests/README.md` - Updated with new test info

## 📦 Dependencies Added

```json
{
  "@storacha/upload-api": "^2.8.4",
  "@storacha/capabilities": "^1.12.0",
  "@ucanto/server": "^9.0.0"
}
```

These enable in-memory upload service testing without Docker or external services.

## 🎬 Expected Test Flow

```
Time    Action                          Location
─────── ─────────────────────────────── ─────────────────
0:00    Create upload service           Backend (in-memory)
0:02    Create space & agent            Backend
0:03    Navigate to app                 Browser (Playwright)
0:05    Create DID with WebAuthn        React UI
0:08    Copy DID from UI                Test automation
0:09    Create delegation (base64)      Backend
0:10    Import delegation               React UI
0:12    Upload test file                React UI
0:15    Reload page                     Browser
0:17    Verify files listed             React UI
0:20    ✅ Test complete!
```

## 🔍 What the Test Validates

### Delegation Chain
```
Space (did:key:z6Mk...)
  └─► Space Agent (did:key:z6Mk...)
        └─► Browser DID (did:key:z6Mk...)
              └─► Can upload files ✅
```

### Persistence After Reload
- ✅ DID survives page reload (via WebAuthn)
- ✅ Delegations survive page reload (localStorage)
- ✅ Files are listed from Storacha space
- ✅ Re-authentication happens transparently

### Format Compatibility
- ✅ multibase-base64 (Storacha CLI: `mYXJj...`)
- ✅ base64url (`uYXJj...`)
- ✅ plain base64 (legacy)

## 📊 Test Output Example

```bash
$ npm run test:e2e -- delegation-upload-flow

Running 2 tests using 1 worker

  ✓  [chromium] › delegation-upload-flow.spec.ts:47:3 › Delegation and Upload Flow - E2E
     › should complete full delegation workflow (18.2s)
  
  ✓  [chromium] › delegation-upload-flow.spec.ts:336:3 › Delegation and Upload Flow - E2E  
     › should handle delegation import with different formats (12.4s)

  2 passed (31.0s)
```

## 🐛 Troubleshooting

### Dev server not running?
```bash
# Start dev server in separate terminal
npm run dev
```

### Test timeout?
```bash
# Increase timeout in test file
test.setTimeout(180000); // 3 minutes
```

### Want to see what's happening?
```bash
# Run in headed mode
npm run test:e2e:headed -- delegation-upload-flow
```

### Import failing?
Check that:
1. DID was created successfully
2. Delegation was encoded properly
3. UI is on "Delegations" tab

### DID parsing error?
The browser DID is a `did:key:z6Mk...` string (public DID), not a private key.
We create a minimal principal object with just the `did()` method for the audience field.

## 📚 Additional Documentation

- **Detailed Guide**: `web/tests/DELEGATION_FLOW_TEST_GUIDE.md`
- **Upload Service Testing**: `docs/UPLOAD_SERVICE_TESTING_GUIDE.md`
- **Test README**: `web/tests/README.md`
- **Issue #2**: https://github.com/NiKrause/ucan-upload-wall/issues/2

## 🎯 Next Steps

This test provides the foundation for:
- [ ] Adding revocation flow tests (Issue #2)
- [ ] Testing delegation expiration
- [ ] Testing error scenarios
- [ ] Adding more complex delegation chains
- [ ] Performance benchmarking

## ✨ Why This Matters

This test validates the **core value proposition** of the UCAN Upload Wall:
1. **Decentralized Identity** - DIDs work correctly
2. **Delegation Chain** - UCANs propagate authority correctly
3. **Persistence** - Data survives browser restarts
4. **Integration** - Backend (Storacha) + Frontend (React) work together

All without requiring:
- ❌ Real Storacha credentials
- ❌ Docker containers
- ❌ External services
- ❌ Network access

The test runs entirely in-memory and takes ~30 seconds! 🚀

