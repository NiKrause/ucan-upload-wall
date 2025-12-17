import { test, expect, Page, BrowserContext, chromium, CDPSession } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';

// Launch a shared browser instance
const browser = await chromium.launch({
  headless: process.env.HEADLESS === 'true',
});

/**
 * User data for testing
 */
const users = [
  {
    name: 'Alice',
    // Alice needs real Storacha credentials for delegation
    storachaKey: process.env.ALICE_STORACHA_KEY || '',
    storachaProof: process.env.ALICE_STORACHA_PROOF || '',
    storachaSpaceDid: process.env.ALICE_STORACHA_SPACE_DID || '',
    did: '', // Will be filled after WebAuthn
  },
  {
    name: 'Bob',
    did: '', // Will be filled after WebAuthn
  },
];

test.describe.configure({ mode: 'serial' });
test.describe.skip('Alice & Bob: Delegation and File Sharing', () => {
  let pageAlice: Page;
  let pageBob: Page;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let cdpSessionAlice: { client: CDPSession; authenticatorId: string };
  let cdpSessionBob: { client: CDPSession; authenticatorId: string };
  let setupComplete = false;

  test.beforeEach(async () => {
    // Only setup once for all tests in serial mode
    if (setupComplete) return;
    
    test.setTimeout(120000); // 2 minutes for setup

    // Initialize Alice's browser
    console.log('🔵 Initializing Alice...');
    contextAlice = await browser.newContext();
    pageAlice = await contextAlice.newPage();
    
    // Enable virtual WebAuthn authenticator for Alice
    cdpSessionAlice = await enableVirtualAuthenticator(contextAlice);
    
    await initializePage(pageAlice, users[0]);

    // Initialize Bob's browser
    console.log('🟢 Initializing Bob...');
    contextBob = await browser.newContext();
    pageBob = await contextBob.newPage();
    
    // Enable virtual WebAuthn authenticator for Bob
    cdpSessionBob = await enableVirtualAuthenticator(contextBob);
    
    await initializePage(pageBob, users[1]);
    
    setupComplete = true;
  });

  test('1. Alice & Bob: Authenticate with Biometric and receive DIDs', async () => {
    test.setTimeout(60000);

    // Alice authenticates
    console.log('🔵 Alice: Authenticating with biometric...');
    await authenticateUser(pageAlice, users[0]);
    
    // Verify Alice got a DID
    expect(users[0].did).toBeTruthy();
    console.log('🔵 Alice DID:', users[0].did);

    // Bob authenticates
    console.log('🟢 Bob: Authenticating with biometric...');
    await authenticateUser(pageBob, users[1]);
    
    // Verify Bob got a DID
    expect(users[1].did).toBeTruthy();
    console.log('🟢 Bob DID:', users[1].did);
  });

  test('2. Alice: Add Storacha credentials', async () => {
    test.setTimeout(90000); // 1.5 minutes

    // Skip if credentials are not provided
    if (!users[0].storachaKey || !users[0].storachaProof) {
      test.skip();
    }

    console.log('🔵 Alice: Adding Storacha credentials...');
    
    // Navigate to delegations tab
    await pageAlice.goto('/');
    await pageAlice.getByRole('button', { name: /delegations/i }).click();
    
    // Wait for delegations page to load
    await pageAlice.waitForTimeout(2000);
    
    // Click "Add Credentials" to open the form if visible
    const showCredentialsBtn = pageAlice.getByRole('button', { name: /add credentials/i }).first();
    const btnExists = await showCredentialsBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (btnExists) {
      await showCredentialsBtn.click();
      await pageAlice.waitForTimeout(1000);
    }
    
    // Fill in credentials (try label first, fall back to placeholder)
    const keyField = pageAlice.getByLabel(/private key/i).or(pageAlice.getByPlaceholder(/storacha private key/i));
    await keyField.fill(users[0].storachaKey);
    
    const proofField = pageAlice.getByLabel(/space proof/i).or(pageAlice.getByPlaceholder(/storacha space proof/i));
    await proofField.fill(users[0].storachaProof);
    
    const didField = pageAlice.getByLabel(/space did/i).or(pageAlice.getByPlaceholder(/did/i));
    await didField.fill(users[0].storachaSpaceDid);
    
    // Click Save Credentials button
    const saveButton = pageAlice.getByRole('button', { name: /save credentials/i });
    await saveButton.click();
    
    // Wait a moment for the save to complete
    await pageAlice.waitForTimeout(1000);
    
    // Verify credentials were saved by checking if the button shows "Saved" status
    // or if the form is no longer in edit mode
    const credentialsSaved = await pageAlice.getByText(/saved|credentials saved/i).isVisible({ timeout: 2000 }).catch(() => false);
    if (credentialsSaved) {
      console.log('✅ Alice: Storacha credentials saved (verified by message)');
    } else {
      // Alternative: check if "Create Delegation" button is now enabled
      const createDelegationBtn = pageAlice.getByRole('button', { name: /create delegation/i });
      await expect(createDelegationBtn).toBeVisible({ timeout: 3000 });
      console.log('✅ Alice: Storacha credentials saved (verified by enabled delegation button)');
    }
  });

  test('3. Alice: Create delegation to Bob', async () => {
    test.setTimeout(90000);

    console.log('🔵 Alice: Creating delegation to Bob...');
    
    // Make sure we're on the delegations page (don't navigate if already there)
    const currentUrl = pageAlice.url();
    if (!currentUrl.includes('delegations')) {
      await pageAlice.goto('/');
      await pageAlice.getByRole('button', { name: /delegations/i }).click();
      await pageAlice.waitForTimeout(1000);
    }
    
    // Click "Create Delegation" button
    const createDelegationBtn = pageAlice.getByRole('button', { name: /create delegation/i }).first();
    await createDelegationBtn.click();
    await pageAlice.waitForTimeout(1000);
    
    // Fill in Bob's DID - use placeholder as fallback
    const didInput = pageAlice.getByLabel(/target did/i).or(pageAlice.getByPlaceholder(/did:key/i));
    await didInput.fill(users[1].did);
    
    // Select capabilities (default should be "Basic (Upload + List)" with 4 capabilities)
    // Wait for capability checkboxes to load
    await pageAlice.waitForTimeout(1000);
    
    // The capabilities are already selected by default (4 capability(ies))
    // Click the green "Create Delegation" button at the bottom of the form
    // This is the one with the upload icon inside the form
    const submitButton = pageAlice.locator('form').getByRole('button', { name: /create delegation/i }).first();
    await submitButton.click();
    
    // Wait for delegation to be created
    await expect(pageAlice.getByText(/delegation created|success/i)).toBeVisible({ timeout: 15000 });
    
    // Copy the delegation proof
    const delegationProof = await getDelegationProof(pageAlice);
    expect(delegationProof).toBeTruthy();
    console.log('✅ Alice: Delegation created, proof length:', delegationProof.length);
    
    // Store proof for Bob to import
    users[0].delegationProof = delegationProof;
  });

  test('4. Bob: Import delegation from Alice', async () => {
    test.setTimeout(60000);

    if (!users[0].delegationProof) {
      throw new Error('No delegation proof from Alice');
    }

    console.log('🟢 Bob: Importing delegation from Alice...');
    
    // Navigate to delegations tab
    await pageBob.goto('/');
    await pageBob.getByRole('button', { name: /delegations/i }).click();
    
    // Click "Import Delegation" button
    const importBtn = pageBob.getByRole('button', { name: /import delegation|receive delegation/i }).first();
    await importBtn.click();
    
    // Paste the delegation proof
    await pageBob.getByLabel(/proof|delegation/i).fill(users[0].delegationProof);
    
    // Import it
    await pageBob.getByRole('button', { name: /import|add/i }).click();
    
    // Verify import success
    await expect(pageBob.getByText(/imported|success/i)).toBeVisible({ timeout: 5000 });
    console.log('✅ Bob: Delegation imported successfully');
  });

  test('5. Alice: Upload a test file', async () => {
    test.setTimeout(60000);

    console.log('🔵 Alice: Uploading test file...');
    
    // Navigate to upload tab
    await pageAlice.goto('/');
    await pageAlice.getByRole('button', { name: /upload files/i }).click();
    
    // Create a test file
    const fileName = 'alice-test-file.txt';
    const fileContent = 'Hello from Alice!';
    
    // Upload file (look for file input or drag-drop zone)
    await uploadFile(pageAlice, fileName, fileContent);
    
    // Verify upload success
    await expect(pageAlice.getByText(/successfully uploaded|upload complete/i)).toBeVisible({ timeout: 15000 });
    console.log('✅ Alice: File uploaded successfully');
  });

  test('6. Bob: Upload another test file to the same space', async () => {
    test.setTimeout(60000);

    console.log('🟢 Bob: Uploading test file...');
    
    // Navigate to upload tab
    await pageBob.goto('/');
    await pageBob.getByRole('button', { name: /upload files/i }).click();
    
    // Create a test file
    const fileName = 'bob-test-file.txt';
    const fileContent = 'Hello from Bob!';
    
    // Upload file
    await uploadFile(pageBob, fileName, fileContent);
    
    // Verify upload success
    await expect(pageBob.getByText(/successfully uploaded|upload complete/i)).toBeVisible({ timeout: 15000 });
    console.log('✅ Bob: File uploaded successfully');
  });

  test('7. Alice: List files and see both files', async () => {
    test.setTimeout(60000);

    console.log('🔵 Alice: Listing files...');
    
    // Navigate to upload tab
    await pageAlice.goto('/');
    await pageAlice.getByRole('button', { name: /upload files/i }).click();
    
    // Wait for files to load (might need to click a refresh button)
    await pageAlice.waitForTimeout(2000);
    
    // Check if there's a refresh/list button
    const refreshBtn = pageAlice.getByRole('button', { name: /refresh|list files|show files/i }).first();
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
      await pageAlice.waitForTimeout(2000);
    }
    
    // Verify both files are visible
    // The app should show a file list with both Alice's and Bob's files
    const fileCount = await countVisibleFiles(pageAlice);
    console.log('🔵 Alice sees', fileCount, 'file(s)');
    expect(fileCount).toBeGreaterThanOrEqual(2);
    console.log('✅ Alice: Can see both files');
  });

  test('8. Bob: List files and see both files', async () => {
    test.setTimeout(60000);

    console.log('🟢 Bob: Listing files...');
    
    // Navigate to upload tab
    await pageBob.goto('/');
    await pageBob.getByRole('button', { name: /upload files/i }).click();
    
    // Wait for files to load
    await pageBob.waitForTimeout(2000);
    
    // Check if there's a refresh/list button
    const refreshBtn = pageBob.getByRole('button', { name: /refresh|list files|show files/i }).first();
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
      await pageBob.waitForTimeout(2000);
    }
    
    // Verify both files are visible
    const fileCount = await countVisibleFiles(pageBob);
    console.log('🟢 Bob sees', fileCount, 'file(s)');
    expect(fileCount).toBeGreaterThanOrEqual(2);
    console.log('✅ Bob: Can see both files');
  });

  // Cleanup after ALL tests complete (not after each test)
  test.afterAll(async () => {
    if (!setupComplete) return; // Nothing to clean up
    
    console.log('🧹 Cleaning up...');
    
    try {
      // Disable virtual authenticators
      if (cdpSessionAlice) {
        await disableVirtualAuthenticator(cdpSessionAlice.client, cdpSessionAlice.authenticatorId);
      }
      if (cdpSessionBob) {
        await disableVirtualAuthenticator(cdpSessionBob.client, cdpSessionBob.authenticatorId);
      }
      
      // Close contexts
      await Promise.all([
        contextAlice?.close(),
        contextBob?.close(),
      ]);
    } catch (error) {
      console.warn('⚠️ Cleanup error:', error);
    }
  });
});

/**
 * Helper: Initialize a new page for a user
 */
async function initializePage(page: Page, user: typeof users[0]) {
  const pageUrl = process.env.PAGE_URL || 'http://localhost:5173';
  
  console.log(`📄 Initializing ${user.name}'s page...`);
  await page.goto(pageUrl);
  
  // Clear storage for a fresh start
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  
  // Reload to ensure clean state
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Helper: Authenticate user with WebAuthn biometric
 */
async function authenticateUser(page: Page, user: typeof users[0]) {
  // Look for the biometric authentication button
  // The button text might be "Authenticate with Biometric" or similar
  const authButton = page.getByRole('button', { name: /authenticate|biometric|create did/i }).first();
  
  // Wait for the button to be visible and click it
  await authButton.waitFor({ state: 'visible', timeout: 10000 });
  await authButton.click();
  
  // WebAuthn will trigger - in headed mode, user needs to authenticate
  // In headless mode, this might fail unless virtual authenticator is configured
  // Wait for DID to be created (look for success message or DID display)
  await page.waitForTimeout(5000);
  
  // Try to extract the DID from the page
  // Look for a code element or text that contains "did:key:"
  try {
    const didElement = page.locator('code:has-text("did:key:")').first();
    if (await didElement.isVisible({ timeout: 5000 })) {
      const didText = await didElement.textContent();
      if (didText) {
        user.did = didText.trim();
      }
    }
  } catch {
    console.warn(`⚠️ Could not extract DID for ${user.name} from UI, trying alternative method...`);
    
    // Alternative: look for any element with did:key: text
    const pageContent = await page.content();
    const didMatch = pageContent.match(/did:key:[A-Za-z0-9]+/);
    if (didMatch) {
      user.did = didMatch[0];
    }
  }
  
  if (!user.did) {
    throw new Error(`Failed to get DID for ${user.name}`);
  }
}

/**
 * Helper: Get delegation proof from the page after creation
 */
async function getDelegationProof(page: Page): Promise<string> {
  // After creating a delegation, the app shows the proof in a modal or text area
  // Look for a textarea or code block with the proof
  
  // Wait a bit for the modal to appear
  await page.waitForTimeout(2000);
  
  try {
    // Try to find a textarea or code element with delegation proof
    const proofElement = page.locator('textarea, code').filter({ hasText: /^[A-Za-z0-9+/=]{100,}/ }).first();
    if (await proofElement.isVisible({ timeout: 5000 })) {
      const proof = await proofElement.textContent();
      if (proof) {
        return proof.trim();
      }
    }
    
    // Alternative: look for a copy button and click it, then read from clipboard
    const copyBtn = page.getByRole('button', { name: /copy|clipboard/i }).first();
    if (await copyBtn.isVisible({ timeout: 5000 })) {
      await copyBtn.click();
      // Note: Reading from clipboard in Playwright requires permissions
      // This might not work in all scenarios
    }
  } catch (error) {
    console.error('Error getting delegation proof:', error);
  }
  
  throw new Error('Could not extract delegation proof from page');
}

/**
 * Helper: Upload a file
 */
async function uploadFile(page: Page, fileName: string, content: string) {
  // Create a buffer from the content
  const buffer = Buffer.from(content, 'utf-8');
  
  // Look for file input
  const fileInput = page.locator('input[type="file"]');
  
  if (await fileInput.count() > 0) {
    // Set the file directly on the input
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: buffer,
    });
  } else {
    // If no file input, might be a drag-drop zone
    // Create a DataTransfer and dispatch drop event
    console.warn('⚠️ No file input found, trying drag-drop zone...');
    
    // Find the drop zone
    const dropZone = page.locator('[data-testid="upload-zone"], .upload-zone, [class*="upload"]').first();
    
    // Create a file using the File constructor in the browser
    await dropZone.evaluateHandle((node, { fileName, content }) => {
      const file = new File([content], fileName, { type: 'text/plain' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dataTransfer,
      });
      
      node.dispatchEvent(dropEvent);
    }, { fileName, content });
  }
  
  // Wait for upload to complete
  await page.waitForTimeout(3000);
}

/**
 * Helper: Count visible files in the file list
 */
async function countVisibleFiles(page: Page): Promise<number> {
  // Look for file list items
  // The app might show files in a list, table, or grid
  
  // Try different selectors
  const selectors = [
    '[data-testid="file-item"]',
    '.file-item',
    '[class*="file"] li',
    'table tbody tr',
    '[role="listitem"]',
  ];
  
  for (const selector of selectors) {
    const items = page.locator(selector);
    const count = await items.count();
    if (count > 0) {
      return count;
    }
  }
  
  return 0;
}

// Extend user type to include delegation proof
declare module './alice-bob-delegation.spec' {
  interface User {
    delegationProof?: string;
  }
}
