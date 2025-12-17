import { test, expect, BrowserContext, Page } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';

/**
 * E2E Tests for Hardware-Protected Encrypted Keystore
 * 
 * These tests verify:
 * 1. Creating an encrypted Ed25519 DID with biometric
 * 2. Session lock/unlock flow
 * 3. Fallback to unencrypted when extensions not supported
 * 4. Extension support detection
 */

test.describe('Encrypted Keystore', () => {
  let context: BrowserContext;
  let page: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cdpSession: { client: any; authenticatorId: string };

  test.beforeEach(async ({ browser }) => {
    // Create context with clipboard permissions
    context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create page
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
    // Cleanup
    if (cdpSession) {
      await disableVirtualAuthenticator(cdpSession.client, cdpSession.authenticatorId).catch(() => {});
    }
    await context?.close().catch(() => {});
  });

  test('should show encryption options during DID creation', async () => {
    test.setTimeout(30000);

    console.log('📋 Checking encryption options UI...');

    // Navigate to delegations (where Setup is)
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(2000);

    // Take screenshot for debugging
    await page.screenshot({ path: 'test-debug-1.png', fullPage: true });

    // Look for any indication we're on setup/delegations
    const setupTexts = [
      /Ed25519 DID/i,
      /browser.*setup/i,
      /upload access/i,
    ];
    
    let foundSetup = false;
    for (const text of setupTexts) {
      if (await page.getByText(text).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`✅ Found setup indicator: ${text}`);
        foundSetup = true;
        break;
      }
    }
    
    expect(foundSetup).toBe(true);

    // Look for encryption-related text (more flexible)
    const encryptionTexts = page.locator('text=/hardware.*protect/i, text=/encryption/i');
    const encryptionCount = await encryptionTexts.count();
    expect(encryptionCount).toBeGreaterThan(0);
    console.log(`✅ Found ${encryptionCount} encryption-related text(s)`);

    // Check for largeBlob and hmac-secret
    await expect(page.getByText(/largeBlob/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/hmac.*secret/i).first()).toBeVisible({ timeout: 5000 });
    console.log('✅ Encryption method options found');
  });

  test('should create encrypted DID with biometric prompt', async () => {
    test.setTimeout(60000);

    console.log('🔐 Creating encrypted DID...');

    // Navigate to delegations
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    // Ensure encryption is enabled (should be by default)
    const encryptionCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.getByText(/hardware-protected encryption/i) });
    const isChecked = await encryptionCheckbox.isChecked().catch(() => false);
    if (!isChecked) {
      await encryptionCheckbox.check();
      console.log('✅ Encryption enabled');
    }

    // Click Create DID button
    const createButton = page.getByRole('button', { name: /create secure did|create did/i });
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();
    console.log('🖱️ Clicked create DID button');

    // Wait for DID creation (WebAuthn trigger happens automatically with virtual authenticator)
    await page.waitForTimeout(3000);

    // Verify DID was created with encryption indicator
    const hardwareProtectedIndicator = page.getByText(/🔐 hardware-protected/i);
    await expect(hardwareProtectedIndicator).toBeVisible({ timeout: 10000 });
    console.log('✅ DID created with hardware protection');

    // Extract the DID
    const didElement = page.locator('code').filter({ hasText: /did:key:z6Mk/ });
    await expect(didElement).toBeVisible();
    const did = await didElement.textContent();
    expect(did).toMatch(/^did:key:z6Mk/); // Ed25519 DID format
    console.log('✅ Ed25519 DID:', did);

    // Verify encrypted keystore credential ID is in localStorage
    const hasEncryptedKeystore = await page.evaluate(() => {
      return localStorage.getItem('encrypted_keystore_credential_id') !== null;
    });
    expect(hasEncryptedKeystore).toBe(true);
    console.log('✅ Encrypted keystore credential ID stored');
  });

  test('should show session lock screen after page refresh', async () => {
    test.setTimeout(60000);

    console.log('🔒 Testing session lock after refresh...');

    // First, create encrypted DID
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    const createButton = page.getByRole('button', { name: /create secure did|create did/i });
    await createButton.click();
    await page.waitForTimeout(3000);

    // Verify DID created
    await expect(page.getByText(/🔐 hardware-protected/i)).toBeVisible({ timeout: 10000 });
    console.log('✅ DID created');

    // Refresh the page
    console.log('🔄 Refreshing page...');
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should show session lock screen
    const lockScreen = page.getByText(/session locked/i);
    await expect(lockScreen).toBeVisible({ timeout: 5000 });
    console.log('✅ Session lock screen displayed');

    // Verify unlock button is present
    const unlockButton = page.getByRole('button', { name: /unlock with biometric/i });
    await expect(unlockButton).toBeVisible();
    console.log('✅ Unlock button found');

    // Verify security info is displayed
    const securityInfo = page.getByText(/hardware-protected encryption/i);
    await expect(securityInfo).toBeVisible();
    console.log('✅ Security info displayed');
  });

  test('should unlock session with biometric', async () => {
    test.setTimeout(60000);

    console.log('🔓 Testing session unlock...');

    // Create encrypted DID
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /create secure did|create did/i }).click();
    await page.waitForTimeout(3000);
    await expect(page.getByText(/🔐 hardware-protected/i)).toBeVisible({ timeout: 10000 });

    // Refresh to lock
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/session locked/i)).toBeVisible();
    console.log('✅ Session locked after refresh');

    // Click unlock button
    const unlockButton = page.getByRole('button', { name: /unlock with biometric/i });
    await unlockButton.click();
    console.log('🖱️ Clicked unlock button');

    // Wait for unlock (virtual authenticator handles this)
    await page.waitForTimeout(2000);

    // Verify we're back in the app (not on lock screen)
    await expect(page.getByText(/session locked/i)).not.toBeVisible({ timeout: 5000 });
    console.log('✅ Session unlocked');

    // Verify we can see the app header
    const header = page.getByText(/UCAN Upload Wall/i);
    await expect(header).toBeVisible();
    console.log('✅ App accessible after unlock');

    // Verify security indicator in header shows hardware-protected
    const headerIndicator = page.getByText(/🔐 hardware-protected/i);
    await expect(headerIndicator).toBeVisible({ timeout: 5000 });
    console.log('✅ Hardware-protected indicator in header');
  });

  test('should allow manual session lock via header button', async () => {
    test.setTimeout(60000);

    console.log('🔒 Testing manual session lock...');

    // Create encrypted DID
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /create secure did|create did/i }).click();
    await page.waitForTimeout(3000);
    await expect(page.getByText(/🔐 hardware-protected/i)).toBeVisible({ timeout: 10000 });
    console.log('✅ DID created');

    // Navigate away from delegations to see header
    await page.getByRole('button', { name: /upload files/i }).click();
    await page.waitForTimeout(1000);

    // Look for Lock button in header
    const lockButton = page.getByRole('button', { name: /^lock$/i });
    await expect(lockButton).toBeVisible({ timeout: 5000 });
    console.log('✅ Lock button found in header');

    // Click lock button
    await lockButton.click();
    console.log('🖱️ Clicked lock button');

    // Wait a moment
    await page.waitForTimeout(1000);

    // Should show lock screen
    await expect(page.getByText(/session locked/i)).toBeVisible({ timeout: 5000 });
    console.log('✅ Session locked manually');

    // Verify unlock button is present
    await expect(page.getByRole('button', { name: /unlock with biometric/i })).toBeVisible();
    console.log('✅ Can unlock again');
  });

  test('should create unencrypted DID when encryption disabled', async () => {
    test.setTimeout(60000);

    console.log('⚠️ Testing unencrypted DID creation...');

    // Navigate to delegations
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);

    // Disable encryption checkbox
    const encryptionCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.getByText(/hardware-protected encryption/i) });
    await encryptionCheckbox.uncheck();
    console.log('✅ Encryption disabled');

    // Wait for UI to update
    await page.waitForTimeout(500);

    // Verify warning appears
    const warning = page.getByText(/unencrypted mode/i);
    await expect(warning).toBeVisible();
    console.log('✅ Unencrypted warning displayed');

    // Click Create DID button
    const createButton = page.getByRole('button', { name: /create did/i });
    await createButton.click();
    console.log('🖱️ Clicked create DID button');

    // Wait for DID creation
    await page.waitForTimeout(3000);

    // Verify DID was created with unencrypted indicator
    const unencryptedIndicator = page.getByText(/⚠️ unencrypted/i);
    await expect(unencryptedIndicator).toBeVisible({ timeout: 10000 });
    console.log('✅ DID created without encryption');

    // Verify NO encrypted keystore credential ID in localStorage
    const hasEncryptedKeystore = await page.evaluate(() => {
      return localStorage.getItem('encrypted_keystore_credential_id') !== null;
    });
    expect(hasEncryptedKeystore).toBe(false);
    console.log('✅ No encrypted keystore (as expected)');

    // Verify unencrypted keypair IS in localStorage
    const hasUnencryptedKeypair = await page.evaluate(() => {
      return localStorage.getItem('ed25519_keypair') !== null;
    });
    expect(hasUnencryptedKeypair).toBe(true);
    console.log('✅ Unencrypted keypair in localStorage');

    // Refresh page - should NOT show lock screen
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should NOT see lock screen
    const lockScreen = page.getByText(/session locked/i);
    const isLocked = await lockScreen.isVisible({ timeout: 2000 }).catch(() => false);
    expect(isLocked).toBe(false);
    console.log('✅ No lock screen for unencrypted (as expected)');

    // Verify header shows unencrypted indicator
    await expect(page.getByText(/⚠️ unencrypted/i)).toBeVisible({ timeout: 5000 });
    console.log('✅ Unencrypted indicator in header');
  });
});

test.describe('Extension Support Detection', () => {
  let context: BrowserContext;
  let page: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cdpSession: { client: any; authenticatorId: string };

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    cdpSession = await enableVirtualAuthenticator(context);

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    if (cdpSession) {
      await disableVirtualAuthenticator(cdpSession.client, cdpSession.authenticatorId).catch(() => {});
    }
    await context?.close().catch(() => {});
  });

  test('should detect extension support via checkExtensionSupport', async () => {
    test.setTimeout(30000);

    console.log('🔍 Testing extension support detection...');

    // Check support by calling the function from the page
    const support = await page.evaluate(async () => {
      // Import the function
      const { checkExtensionSupport } = await import('./lib/keystore-encryption');
      return await checkExtensionSupport();
    });

    console.log('Extension support:', support);

    // Virtual authenticator may or may not support extensions
    // Just verify the function returns the expected shape
    expect(support).toHaveProperty('largeBlob');
    expect(support).toHaveProperty('hmacSecret');
    expect(typeof support.largeBlob).toBe('boolean');
    expect(typeof support.hmacSecret).toBe('boolean');

    console.log('✅ Extension support detection works');
  });
});
