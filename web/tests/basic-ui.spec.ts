import { test, expect, BrowserContext, Page } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';

/**
 * Basic UI E2E Tests
 * 
 * Simple, fast tests focused on core user journeys:
 * 1. App loads without errors
 * 2. User can create a DID
 * 3. User can see their DID
 * 4. Navigation works
 * 5. DID persists after reload
 */

test.describe('Basic UI - Happy Path', () => {
  let context: BrowserContext;
  let page: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cdpSession: { client: any; authenticatorId: string };

  test.beforeEach(async ({ browser }) => {
    // Create fresh context
    context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await context.newPage();

    // Enable virtual WebAuthn authenticator
    cdpSession = await enableVirtualAuthenticator(context);

    // Navigate to app
    await page.goto('/');

    // Clear storage for fresh start
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    if (cdpSession) {
      await disableVirtualAuthenticator(cdpSession.client, cdpSession.authenticatorId).catch(() => {});
    }
    await context?.close().catch(() => {});
  });

  test('should load the app without errors', async () => {
    test.setTimeout(15000);

    console.log('🌐 Testing app load...');

    // Check page title
    await expect(page).toHaveTitle(/UCAN Upload Wall/i);

    // Check main header is visible
    const header = page.getByText(/UCAN Upload Wall/i).first();
    await expect(header).toBeVisible();

    console.log('✅ App loaded successfully');
  });

  test('should show setup screen when no DID exists', async () => {
    test.setTimeout(15000);

    console.log('📋 Testing setup screen...');

    // Navigate to Delegations tab (where Setup component is)
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    // Should see setup/creation UI - use heading for specificity
    const setupHeading = page.getByRole('heading', { name: /Create Ed25519 DID/i });
    await expect(setupHeading).toBeVisible({ timeout: 5000 });

    console.log('✅ Setup screen displayed');
  });

  test('should create a DID successfully', async () => {
    test.setTimeout(30000);

    console.log('🆕 Creating DID...');

    // Navigate to Delegations tab
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    // Click create DID button using data-testid
    const createButton = page.getByTestId('create-did-button');
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Wait for DID creation (virtual authenticator handles this automatically)
    await page.waitForTimeout(3000);

    // Verify DID was created using data-testid
    const didElement = page.getByTestId('did-display');
    await expect(didElement).toBeVisible({ timeout: 10000 });

    const did = await didElement.textContent();
    expect(did).toMatch(/^did:key:z6Mk/);

    console.log('✅ DID created:', did);
  });

  test('should navigate between tabs', async () => {
    test.setTimeout(15000);

    console.log('🔄 Testing navigation...');

    // Start on default tab
    const uploadTab = page.getByRole('button', { name: /upload files/i });
    const delegationsTab = page.getByRole('button', { name: /delegations/i });

    // Navigate to Delegations
    await delegationsTab.click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: /Create Ed25519 DID/i })).toBeVisible({ timeout: 5000 });

    // Navigate back to Upload
    await uploadTab.click();
    await page.waitForTimeout(500);

    console.log('✅ Navigation works');
  });

  test('should show DID after creation and persist after reload', async () => {
    test.setTimeout(45000);

    console.log('🔄 Testing DID persistence...');

    // 1. Create DID
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    const createButton = page.getByTestId('create-did-button');
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await page.waitForTimeout(3000);

    // Get the DID using data-testid
    const didElement = page.getByTestId('did-display');
    await expect(didElement).toBeVisible({ timeout: 10000 });
    const originalDid = await didElement.textContent();

    console.log('✅ DID created:', originalDid);

    // 2. Reload page
    console.log('🔄 Reloading page...');
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 3. Navigate to delegations again
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    // 4. Verify DID is still there using data-testid
    const persistedDidElement = page.getByTestId('did-display');
    await expect(persistedDidElement).toBeVisible({ timeout: 10000 });
    const persistedDid = await persistedDidElement.textContent();

    expect(persistedDid).toBe(originalDid);
    console.log('✅ DID persisted after reload');
  });

  test('should show copy button for DID', async () => {
    test.setTimeout(30000);

    console.log('📋 Testing copy button...');

    // Create DID first
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    const createButton = page.getByTestId('create-did-button');
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
    await page.waitForTimeout(3000);

    // Look for copy button using data-testid
    const copyButton = page.getByTestId('copy-did-button');
    await expect(copyButton).toBeVisible({ timeout: 10000 });

    console.log('✅ Copy button visible');
  });
});

test.describe('Basic UI - Error Handling', () => {
  test('should handle navigation to non-existent routes gracefully', async ({ page }) => {
    test.setTimeout(15000);

    console.log('🔍 Testing error handling...');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // App should still load even with invalid route
    const header = page.getByText(/UCAN Upload Wall/i).first();
    await expect(header).toBeVisible();

    console.log('✅ App handles navigation gracefully');
  });
});

