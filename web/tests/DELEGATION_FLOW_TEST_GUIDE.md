# Delegation and Upload Flow E2E Test Guide

## Overview

The `delegation-upload-flow.spec.ts` test implements a comprehensive end-to-end test for the complete UCAN delegation workflow. This test addresses [Issue #2](https://github.com/NiKrause/ucan-upload-wall/issues/2) by combining:

1. **In-memory Storacha upload service** (backend)
2. **React UI interactions** (frontend via Playwright)
3. **Full delegation chain** (space → agent → browser DID → upload → persist)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Architecture                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐         ┌──────────────────┐        │
│  │ In-Memory        │         │ React UI         │        │
│  │ Upload Service   │◄────────┤ (Playwright)     │        │
│  │ (@storacha)      │  UCAN   │                  │        │
│  └──────────────────┘  Proofs └──────────────────┘        │
│         ▲                              │                    │
│         │                              │                    │
│         │ 1. Create Space              │ 2. Create DID     │
│         │ 2. Provision Space           │ 3. Import Token   │
│         │ 3. Create Delegation         │ 4. Upload File    │
│         │ 4. Encode as Base64          │ 5. Reload Page    │
│         │                              │ 6. Verify Files   │
│         └──────────────────────────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Test Workflow

### Step 1: Setup In-Memory Upload Service
```typescript
uploadServiceContext = await createContext({
  requirePaymentPlan: false
});
```
- Creates in-memory storage and services
- No Docker or external dependencies required
- Fast execution (~3-5 minutes total)

### Step 2: Create Space and Agent
```typescript
spaceAgent = await ed25519.generate();
space = await ed25519.generate();
spaceProof = await delegate({
  issuer: space,
  audience: spaceAgent,
  capabilities: [{ can: '*', with: space.did() }],
});
```
- Simulates CLI user with Storacha credentials
- Creates a space (storage bucket)
- Delegates full authority to space agent

### Step 3: Create DID in React UI
```typescript
await page.getByRole('button', { name: /delegations/i }).click();
const createButton = page.getByTestId('create-did-button');
await createButton.click();
const browserDID = await didElement.textContent();
```
- Uses Playwright to interact with UI
- Virtual WebAuthn authenticator enabled
- Extracts DID from UI (e.g., `did:key:z6Mk...`)

### Step 4: Create Delegation from Space to Browser DID
```typescript
const delegation = await delegate({
  issuer: spaceAgent,
  audience: browserPrincipal,
  capabilities: [
    Store.add.create({ with: space.did(), nb: {} }),
    Upload.add.create({ with: space.did(), nb: {} }),
    Upload.list.create({ with: space.did(), nb: {} })
  ],
  proofs: [spaceProof],
});
```
- Creates UCAN delegation granting upload permissions
- Includes proof chain (space → agent → browser)
- Encodes as base64 with multibase prefix

### Step 5: Import Delegation into UI
```typescript
await importButton.click();
await nameInput.fill('Test Space Delegation');
await delegationTextarea.fill(delegationBase64);
await importSubmitButton.click();
```
- Pastes base64 delegation token into UI
- UI automatically detects format
- Stores delegation for upload operations

### Step 6: Upload File
```typescript
const testFile = new File([testFileContent], 'test-file.txt');
await fileInput.evaluateHandle(/* ... */);
await uploadButton.click();
```
- Creates test file
- Uploads using delegation
- File stored in Storacha space

### Step 7: Reload and Verify Persistence
```typescript
await page.reload();
await page.waitForLoadState('networkidle');
// Re-authenticate happens automatically
const fileElements = page.locator('code:has-text("bafy")');
expect(await fileElements.count()).toBeGreaterThan(0);
```
- Reloads page (simulates browser restart)
- WebAuthn re-authentication happens transparently
- Verifies files still listed (persistence test)

## Test Cases

### 1. Full Delegation Workflow
Tests the complete happy path:
- ✅ Creates in-memory upload service
- ✅ Creates space and provisions it
- ✅ Creates DID in React UI
- ✅ Creates delegation from space to browser DID
- ✅ Imports delegation into UI
- ✅ Uploads file
- ✅ Verifies file persists after page reload

### 2. Delegation Format Compatibility
Tests multiple delegation encoding formats:
- ✅ multibase-base64 with 'm' prefix (Storacha CLI default)
- ✅ base64url with 'u' prefix
- ✅ plain base64 (legacy)

## Prerequisites

### Dependencies
```bash
npm install --save-dev \
  @storacha/upload-api@^2.8.4 \
  @storacha/capabilities@^1.12.0 \
  @ucanto/server@^9.0.0
```

### Dev Server
The test requires the dev server to be running:
```bash
npm run dev
```

## Running the Tests

### Run specific test
```bash
npm run test:e2e -- delegation-upload-flow
```

### Run with headed browser (see what's happening)
```bash
npm run test:e2e:headed -- delegation-upload-flow
```

### Debug mode (step through)
```bash
npm run test:e2e:debug -- delegation-upload-flow
```

### Watch mode
```bash
npx playwright test delegation-upload-flow --ui
```

## Expected Output

```
🚀 Setting up test environment...
📦 Creating in-memory upload service...
✅ Upload service created: did:web:...
🔑 Creating space agent...
✅ Space created: did:key:z6Mk...
✅ Space agent created: did:key:z6Mk...
📝 Provisioning space with upload service...
✅ Space provisioned
🌐 Setting up browser context...
✅ Browser setup complete

🎯 TEST START: Complete Delegation Workflow

📝 STEP 1: Creating DID in React UI...
✅ Browser DID: did:key:z6Mk...

📋 STEP 2: Extracting DID from UI...
✅ Browser DID: did:key:z6Mk...

🔐 STEP 3: Creating delegation from space to browser DID...
✅ Delegation created
📦 Delegation size: 1234 chars
📄 Delegation preview: mYXJjaGl...

📥 STEP 4: Importing delegation into React UI...
✅ Delegation imported successfully

📤 STEP 5: Uploading test file...
✅ File uploaded (waiting for confirmation)

🔄 STEP 6: Reloading page to test persistence...
🔐 Re-authenticating with WebAuthn...

✅ STEP 7: Verifying files persist after reload...
📁 Found 1 file(s) after reload
📦 First file CID: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi

✅ TEST PASSED: Complete delegation workflow successful!
```

## Debugging Tips

### Test Timing Out?
- Increase timeout: `test.setTimeout(180000)` (3 minutes)
- Check dev server is running on port 5173
- Add more `waitForTimeout()` calls

### WebAuthn Issues?
- Virtual authenticator not enabled properly
- Try running in headed mode to see prompts
- Check `helpers/webauthn.ts` setup

### Delegation Import Fails?
- Check base64 encoding (should start with 'm', 'u', or be plain base64)
- Verify delegation has correct capabilities
- Check proof chain is valid

### Files Not Persisting?
- Check localStorage is enabled
- Verify WebAuthn re-authentication works
- Look for console errors in browser

## Related Files

- **Test File**: `web/tests/delegation-upload-flow.spec.ts`
- **WebAuthn Helper**: `web/tests/helpers/webauthn.ts`
- **Delegation Service**: `web/src/lib/ucan-delegation.ts`
- **Delegation Manager UI**: `web/src/components/DelegationManager.tsx`
- **Upload Zone UI**: `web/src/components/UploadZone.tsx`
- **Testing Guide**: `docs/UPLOAD_SERVICE_TESTING_GUIDE.md`

## References

- [Issue #2: Add E2E tests for UCAN revocation flow](https://github.com/NiKrause/ucan-upload-wall/issues/2)
- [UCANTO Protocol](https://github.com/web3-storage/ucanto)
- [Storacha Documentation](https://docs.storacha.network)
- [Upload Service Testing Patterns](https://github.com/storacha/upload-service/tree/main/packages/upload-api/src/test)
- [Playwright Documentation](https://playwright.dev)

## Future Enhancements

- [ ] Add revocation flow tests (create → revoke → verify blocked)
- [ ] Test delegation expiration handling
- [ ] Test multiple concurrent uploads
- [ ] Test delegation chaining (re-delegation)
- [ ] Test error scenarios (invalid delegation, network failures)
- [ ] Add visual regression tests
- [ ] Measure and optimize test execution time

