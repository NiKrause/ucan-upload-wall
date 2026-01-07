# Archived E2E Tests

**Date Archived:** January 5, 2026

These tests have been archived because they were:
- ⚠️ Too complex (500-700 lines each)
- ⚠️ Brittle and frequently failing
- ⚠️ Testing deprecated features
- ⚠️ Requiring real API credentials
- ⚠️ Incomplete or skipped

## Archived Files

### `encrypted-keystore.spec.ts`

**Why archived:** Testing old largeBlob/hmac-secret encryption architecture

**Status:** 6 out of 7 tests were failing

**Issues:**
- Looking for encryption UI that was replaced with PRF implementation
- Checkbox selectors not matching current UI
- Extension detection test importing non-existent module
- Tests timing out waiting for elements that don't exist

**What it tested:**
- Hardware-protected encryption UI (old approach)
- Session lock/unlock with largeBlob extension
- Manual locking via header button
- Unencrypted DID fallback
- Extension support detection

**Replacement:** New `basic-ui.spec.ts` tests core DID creation without focusing on old encryption UI

### `alice-bob-delegation.spec.ts`

**Why archived:** Skipped, requires real Storacha credentials

**Status:** All tests wrapped in `test.describe.skip()`

**Issues:**
- Required environment variables: `ALICE_STORACHA_KEY`, `ALICE_STORACHA_PROOF`, `ALICE_STORACHA_SPACE_DID`
- Too complex for CI/CD
- Testing entire workflow instead of focused scenarios

**What it tested:**
- Two-user delegation flow
- Alice creates delegation for Bob
- Bob imports delegation
- Both upload files
- File sharing between users

**Replacement:** Should be rewritten with mocked API calls, broken into smaller tests

### `alice-bob-workflow.spec.ts`

**Why archived:** Has early `return` statements, incomplete

**Status:** Stops mid-execution at lines 549, 596, 700

**Issues:**
- Test stops after uploading files (never verifies list functionality)
- Debugging `return` statements left in code
- Too complex (700+ lines for one test)
- Requires real Storacha credentials

**What it tested (partially):**
- Complete Alice & Bob workflow
- DID extraction and authentication
- Delegation creation and import
- File upload (but verification incomplete)
- Delegation proof parsing with `@ucanto/core`

**Replacement:** Break into separate focused tests with mocks

## Historical Documentation

### `ANALYSIS.md`

Analysis of test failures and recommendations for fixes. No longer relevant with new test architecture.

### `SETUP_SUMMARY.md`

Summary of test setup and configuration. Superseded by main `README.md`.

### `README.old.md`

Previous version of test documentation before reorganization.

## Migration Notes

### What Was Good

✅ Virtual WebAuthn authenticator setup  
✅ Console logging for debugging  
✅ Helper functions in `helpers/webauthn.ts`  
✅ Clipboard permissions setup  

### What Was Problematic

❌ Tests too long and complex  
❌ Real API credentials required  
❌ Testing UI implementation details  
❌ Not following "test one thing" principle  
❌ Timeouts instead of proper waits  

## Lessons Learned

1. **Keep tests simple** - One test = one thing
2. **Mock external APIs** - Don't require real credentials
3. **Test user behavior** - Not implementation details
4. **Use proper waits** - Not arbitrary timeouts
5. **Make tests maintainable** - <150 lines per test file

## Potential Reuse

If you need to recreate delegation/upload tests:

1. **Extract helper functions** from archived tests:
   - `extractFullDID()` - Robust DID extraction
   - `getDelegationProof()` - Extract proof from UI
   - `uploadFile()` - File upload helper
   - `countVisibleFiles()` - File list verification

2. **Rewrite with mocks:**
   ```typescript
   // Mock Storacha API
   await page.route('**/upload**', route => {
     route.fulfill({
       status: 200,
       body: JSON.stringify({ success: true })
     });
   });
   ```

3. **Break into focused tests:**
   - Test delegation creation UI
   - Test delegation import UI
   - Test upload UI
   - Test file list UI
   - Don't test all together

## References

- New tests: `../basic-ui.spec.ts`
- Helper functions: `../helpers/webauthn.ts`
- Test documentation: `../README.md`

---

**Note:** These files are kept for reference but should not be run. They will fail with current implementation.


