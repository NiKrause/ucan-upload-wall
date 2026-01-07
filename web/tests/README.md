# E2E Tests

## Overview

Simple, focused end-to-end tests for the UCAN Upload Wall application.

## Test Files

### `basic-ui.spec.ts` ✅ **ACTIVE**

**Focus:** Core user interface functionality

**Tests:**
- ✅ App loads without errors
- ✅ Setup screen shows when no DID exists
- ✅ User can create a DID
- ✅ Navigation between tabs works
- ✅ DID persists after page reload
- ✅ Copy button is available
- ✅ Error handling works

**Run:**
```bash
npm run test:e2e -- basic-ui
```

**Duration:** ~2 minutes for all tests

### `delegation-upload-flow.spec.ts` ✅ **ACTIVE**

**Focus:** Complete UCAN delegation and upload workflow

**Tests:**
- ✅ Full delegation flow: create space → DID → delegate → import → upload → persist
- ✅ Delegation format compatibility (multibase-base64, base64url, plain-base64)
- ✅ File persistence after page reload
- ✅ In-memory upload service integration

**Run:**
```bash
npm run test:e2e -- delegation-upload-flow
```

**Prerequisites:**
```bash
npm install --save-dev @storacha/upload-api @storacha/capabilities @ucanto/server
```

**Duration:** ~3-5 minutes (includes upload service setup)

**Architecture:**
- Uses in-memory Storacha upload service (no external dependencies)
- Combines backend (UCANTO protocol) with frontend (Playwright UI)
- Tests end-to-end delegation chain and file upload persistence

### `archive/` ⚠️ **ARCHIVED**

Contains old/complex tests that were:
- Too brittle or incomplete
- Testing deprecated features
- Requiring real API credentials

See `archive/README.md` for details.

## Running Tests

```bash
# Run all active tests
npm run test:e2e

# Run specific test file
npm run test:e2e -- basic-ui

# Run with visible browser
npm run test:e2e:headed -- basic-ui

# Debug mode
npm run test:e2e:debug -- basic-ui

# Interactive UI mode
npm run test:e2e:ui
```

## Test Philosophy

### ✅ **DO:**
- Test core user journeys
- Keep tests simple and fast
- Focus on what users actually do
- Use virtual authenticators
- Test error states

### ❌ **DON'T:**
- Create 500+ line test files
- Test every edge case in E2E (use unit tests)
- Require real API credentials
- Test implementation details

## Writing New Tests

Keep it simple:

```typescript
test('should do something users care about', async ({ page }) => {
  // 1. Arrange - set up the scenario
  await page.goto('/');
  
  // 2. Act - user performs action
  await page.click('button');
  
  // 3. Assert - verify result
  await expect(page.getByText('Success')).toBeVisible();
});
```

## CI/CD Integration

These tests are designed to run in CI:
- ✅ No external dependencies
- ✅ Virtual WebAuthn authenticator
- ✅ Fast execution (~2 min total)
- ✅ Deterministic results

## Helpers

### `helpers/webauthn.ts`

Provides virtual WebAuthn authenticator setup for testing:

```typescript
import { enableVirtualAuthenticator } from './helpers/webauthn';

const { client, authenticatorId } = await enableVirtualAuthenticator(context);
```

This allows WebAuthn to work in headless/automated mode without real biometric hardware.

## Test Structure

```
tests/
├── basic-ui.spec.ts        # ✅ Active: Core UI tests
├── helpers/
│   └── webauthn.ts         # WebAuthn test helpers
├── archive/                # ⚠️ Archived: Old/incomplete tests
│   ├── encrypted-keystore.spec.ts
│   ├── alice-bob-delegation.spec.ts
│   ├── alice-bob-workflow.spec.ts
│   └── README.md           # Archive documentation
└── README.md               # This file
```

## Adding New Tests

When adding new tests:

1. **Keep it simple** - Each test should test ONE thing
2. **Use descriptive names** - `should create a DID successfully` not `test1`
3. **Add console logs** - Help debugging when tests fail
4. **Set reasonable timeouts** - 15-30 seconds max
5. **Clean up** - Use `beforeEach` and `afterEach` hooks

Example:

```typescript
test('should show error when network is offline', async () => {
  test.setTimeout(20000);
  
  console.log('🔌 Testing offline behavior...');
  
  // Simulate offline
  await context.setOffline(true);
  
  // Try to create DID
  await page.getByRole('button', { name: /create/i }).click();
  
  // Verify error message
  await expect(page.getByText(/network error/i)).toBeVisible();
  
  console.log('✅ Error shown correctly');
});
```

## Troubleshooting

### Tests failing locally?

1. **Clear browser data:**
   ```bash
   rm -rf web/test-results/
   ```

2. **Update Playwright:**
   ```bash
   npm run playwright:install
   ```

3. **Run in headed mode:**
   ```bash
   npm run test:e2e:headed -- basic-ui
   ```

### Tests timing out?

- Check dev server is running on port 5173
- Increase timeout: `test.setTimeout(30000)`
- Add more `waitForTimeout()` calls

### WebAuthn not working?

- Virtual authenticator may not be enabled
- Check `helpers/webauthn.ts` setup
- Try running in Chromium only

## Next Steps

- [x] Add tests for upload functionality
- [x] Add tests for delegation creation
- [ ] Add tests for delegation revocation flow (Issue #2)
- [ ] Add tests for error boundaries
- [ ] Add visual regression tests
- [ ] Integrate into CI/CD pipeline
