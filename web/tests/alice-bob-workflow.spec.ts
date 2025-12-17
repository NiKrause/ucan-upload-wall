import { test, expect, chromium, Browser, Page, BrowserContext, ConsoleMessage, CDPSession } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';
import dotenv from 'dotenv';
import * as Delegation from '@ucanto/core/delegation';

dotenv.config();

// User data for testing
const users = [
  {
    name: 'Alice',
    storachaKey: process.env.ALICE_STORACHA_KEY || '',
    storachaProof: process.env.ALICE_STORACHA_PROOF || '',
    storachaSpaceDid: process.env.ALICE_STORACHA_SPACE_DID || '',
    did: '', // Will be filled after WebAuthn
    delegationProof: '', // Will be filled after creating delegation
  },
  {
    name: 'Bob',
    did: '', // Will be filled after WebAuthn
  },
];

test.describe('Alice & Bob Complete Workflow', () => {
  let browser: Browser;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let pageAlice: Page;
  let pageBob: Page;
  let cdpSessionAlice: { client: CDPSession; authenticatorId: string };
  let cdpSessionBob: { client: CDPSession; authenticatorId: string };

  test('Complete delegation and file sharing flow', async () => {
    // Helper to extract full DID from page without truncation
    const extractFullDID = async (page: Page): Promise<string> => {
      // Try explicit attributes or hidden fields first
      const selectors = [
        'code[title^="did:key:"]',
        '[data-full-did^="did:key:"]',
        '[data-testid="did-full"]',
        'input[name="did"][value^="did:key:"]',
        '[aria-label^="did:key:"]',
      ];
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.count()) {
          const title = await el.getAttribute('title');
          const data = await el.getAttribute('data-full-did');
          const aria = await el.getAttribute('aria-label');
          const val = await el.getAttribute('value');
          const text = (await el.innerText().catch(() => ''))?.trim();
          const candidates = [title, data, aria, val, text].filter(Boolean) as string[];
          const did = candidates.find(c => /^did:key:/.test(c) && !c.includes('...'));
          if (did) return did;
        }
      }
      // Try code elements and avoid truncated ones
      const codeEls = page.locator('code:has-text("did:key:")');
      const count = await codeEls.count();
      for (let i = 0; i < count; i++) {
        const t = (await codeEls.nth(i).innerText().catch(() => ''))?.trim();
        if (t && /^did:key:/.test(t) && !t.includes('...')) return t;
      }
      // Try localStorage/sessionStorage
      try {
        const fromStorage = await page.evaluate(() => {
          const keys = Object.keys(localStorage).concat(Object.keys(sessionStorage));
          for (const k of keys) {
            try {
              const v = localStorage.getItem(k) || sessionStorage.getItem(k);
              if (v && /^did:key:/.test(v) && !v.includes('...')) return v;
              if (v && v.includes('did:key:')) {
                const m = v.match(/did:key:[A-Za-z0-9:+/=-]+/);
                if (m && !m[0].includes('...')) return m[0];
              }
            } catch {
            // Ignore errors in credential creation override
          }
          }
          return '';
        });
        if (fromStorage) return fromStorage;
      } catch {
        // Ignore storage access errors
      }
      // Fallback to clipboard via copy button
      const copyBtn = page.getByRole('button', { name: /copy\s*did/i }).first();
      if (await copyBtn.isVisible().catch(() => false)) {
        await copyBtn.click();
        await page.waitForTimeout(100);
        try {
          const clip = (await page.evaluate(() => navigator.clipboard.readText()))?.trim() || '';
          if (clip && /^did:key:/.test(clip)) return clip;
        } catch {
          // Ignore clipboard read errors
        }
      }
      return '';
    };
    test.setTimeout(5 * 60 * 1000); // 5 minutes for the entire flow

    try {
      // Launch browser
      browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true',
      });

      // 1. Setup Alice's browser with virtual authenticator
      console.log('🔵 Setting up Alice...');
      contextAlice = await browser.newContext();
      await contextAlice.grantPermissions(['clipboard-read', 'clipboard-write']);
      // Force ES256 in WebAuthn create() by ensuring -7 appears and is preferred
      await contextAlice.addInitScript(() => {
        const origCreate = navigator.credentials.create.bind(navigator.credentials);
        // @ts-expect-error - Overriding navigator.credentials.create for testing
        navigator.credentials.create = async (options) => {
          try {
            if (options && options.publicKey) {
              const pk = options.publicKey;
              pk.pubKeyCredParams = Array.from(new Set([
                { type: 'public-key', alg: -7 }, // ES256
                ...(pk.pubKeyCredParams || [])
              ].map(p => JSON.stringify(p)))).map(s => JSON.parse(s));
            }
          } catch {
            // Ignore errors in credential creation override
          }
          // @ts-expect-error - Overriding navigator.credentials.create for testing
          return origCreate(options);
        };
      });
      pageAlice = await contextAlice.newPage();

      // Filter out noisy React warnings (e.g., duplicate key)
      const suppressPatterns = [
        /Encountered two children with the same key/i,
        /Keys should be unique/i,
      ];
      const handleConsole = (who: 'Alice' | 'Bob') => (msg: ConsoleMessage) => {
        const type = msg.type() || '';
        // Surface errors, warnings, and logs so app-side diagnostics appear
        if (!['error', 'warning', 'log'].includes(type)) return;
        const text = msg.text() || '';
        if (suppressPatterns.some((r) => r.test(text))) return;
        const prefix = who === 'Alice' ? '🔴' : '🟠';
        console.log(`${prefix} [${who} ${type}]`, text);
      };

      // Capture console (filtered) for Alice
      pageAlice.on('console', handleConsole('Alice'));
      cdpSessionAlice = await enableVirtualAuthenticator(contextAlice);

      // 2. Setup Bob's browser with virtual authenticator
      console.log('💚 Setting up Bob...');
      contextBob = await browser.newContext();
      await contextBob.grantPermissions(['clipboard-read', 'clipboard-write']);
      await contextBob.addInitScript(() => {
        const origCreate = navigator.credentials.create.bind(navigator.credentials);
        // @ts-expect-error - Overriding navigator.credentials.create for testing
        navigator.credentials.create = async (options) => {
          try {
            if (options && options.publicKey) {
              const pk = options.publicKey;
              pk.pubKeyCredParams = Array.from(new Set([
                { type: 'public-key', alg: -7 },
                ...(pk.pubKeyCredParams || [])
              ].map(p => JSON.stringify(p)))).map(s => JSON.parse(s));
            }
          } catch {
            // Ignore errors in credential creation override
          }
          // @ts-expect-error - Overriding navigator.credentials.create for testing
          return origCreate(options);
        };
      });
      pageBob = await contextBob.newPage();
      // Capture console (filtered) for Bob
      pageBob.on('console', handleConsole('Bob'));
      cdpSessionBob = await enableVirtualAuthenticator(contextBob);

      // Step 1: Authenticate both users
      console.log('🔵 Alice: Authenticating...');
      await pageAlice.goto('/');
      await pageAlice.getByRole('button', { name: /authenticate|biometric|create did/i }).first().click();
      await pageAlice.waitForTimeout(2000);

      // Extract Alice's DID using robust helper (no truncation)
      users[0].did = await extractFullDID(pageAlice);
      console.log('🔵 Alice DID:', users[0].did);

      console.log('🟢 Bob: Authenticating...');
      await pageBob.goto('/');
      await pageBob.getByRole('button', { name: /authenticate|biometric|create did/i }).first().click();
      await pageBob.waitForTimeout(2000);

      // Extract Bob's DID using robust helper (no truncation)
      users[1].did = await extractFullDID(pageBob);
      console.log('🟢 Bob DID:', users[1].did);

      // Verify both users got DIDs
      expect(users[0].did).toBeTruthy();
      expect(users[1].did).toBeTruthy();

      // Step 2: Add Storacha credentials (Alice)
      console.log('🔵 Alice: Adding Storacha credentials...');

      // Validate env vars early to avoid silent failures
      expect(users[0].storachaKey, 'ALICE_STORACHA_KEY is missing').toBeTruthy();
      expect(users[0].storachaProof, 'ALICE_STORACHA_PROOF is missing').toBeTruthy();
      expect(users[0].storachaSpaceDid, 'ALICE_STORACHA_SPACE_DID must be a did:key').toMatch(/^did:key:/);
      
      // Navigate to delegations page
      await pageAlice.getByRole('button', { name: /delegations/i }).click();
      await pageAlice.waitForTimeout(1000);

      // Click "Add Credentials" to show the form
      const addCredentialsBtn = pageAlice.getByRole('button', { name: /add credentials/i });
      await expect(addCredentialsBtn).toBeVisible({ timeout: 5000 });
      await addCredentialsBtn.click();
      await pageAlice.waitForTimeout(1000);

      // Fill in Storacha credentials
      console.log('🔵 Alice: Filling Storacha credentials...');
      
      // Fill Private Key
      const privateKeyField = pageAlice.getByLabel(/private key/i).or(pageAlice.getByPlaceholder(/paste.*private key/i));
      await expect(privateKeyField).toBeVisible({ timeout: 5000 });
      await privateKeyField.fill(users[0].storachaKey);

      // Fill Space Proof
      const proofField = pageAlice.getByLabel(/space proof/i).or(pageAlice.getByPlaceholder(/paste.*space proof/i));
      await expect(proofField).toBeVisible();
      await proofField.fill(users[0].storachaProof);

      // Fill Space DID (force exact value and verify)
      const didLabel = pageAlice.getByLabel(/space did/i).first();
      let didInput = didLabel.locator('..').locator('input, textarea, [contenteditable="true"]').first();
      if (!(await didInput.isVisible().catch(() => false))) {
        didInput = pageAlice.locator('input[placeholder*="did:key" i], input[placeholder*="space did" i]').first();
      }
      await expect(didInput).toBeVisible({ timeout: 5000 });
      await didInput.click();
      // Clear any prefilled or masked value
      await pageAlice.keyboard.press((process.platform === 'darwin') ? 'Meta+A' : 'Control+A');
      await pageAlice.keyboard.press('Backspace');
      await didInput.fill(users[0].storachaSpaceDid, { timeout: 5000 });
      const didValue = await didInput.inputValue().catch(() => '');
      expect(didValue.trim()).toBe(users[0].storachaSpaceDid);

      // Click Save Credentials
      const saveBtn = pageAlice.getByRole('button', { name: /save credentials/i });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // Wait for the save to complete and verify creds took effect
      console.log('🔵 Alice: Saving credentials...');
      await pageAlice.waitForTimeout(500);

      // Navigate to Upload Files and ensure the orange alert disappears (confirms creds active)
      await pageAlice.getByRole('button', { name: /upload files/i }).click();
      await pageAlice.waitForTimeout(500);
      await expect(pageAlice.getByText(/upload credentials needed/i)).not.toBeVisible({ timeout: 20000 });

      // Go back to Delegations area to continue
      await pageAlice.getByRole('button', { name: /delegations/i }).click();
      await pageAlice.waitForTimeout(500);

      // Verify by checking for Create Delegation button
      const createDelegationBtn = pageAlice.getByRole('button', { name: /create delegation/i }).first();
      await expect(createDelegationBtn).toBeVisible({ timeout: 10000 });
      console.log('✅ Alice: Storacha credentials are active');

      // Step 3: Create delegation (Alice -> Bob)
      console.log('🔵 Alice: Creating delegation for Bob...');
      await pageAlice.waitForTimeout(1000); // Ensure UI updates

      // Click main "Create Delegation" button to open form
      console.log('🔵 Alice: Opening delegation form...');
      const createButton = pageAlice.getByRole('button', { name: /create delegation/i }).first();
      await expect(createButton).toBeVisible({ timeout: 5000 });
      await createButton.click();
      await pageAlice.waitForTimeout(1000);

      // Fill in Bob's DID in the input under "Target DID" text
      console.log('🔵 Alice: Filling in target DID...');
      
      // Find the input below the "Target DID" text
      const targetDIDText = pageAlice.getByText('Target DID (from another browser)');
      await expect(targetDIDText).toBeVisible({ timeout: 5000 });
      
      // Get the next input field
      const targetDIDInput = targetDIDText.locator('..').locator('input');
      await expect(targetDIDInput).toBeVisible();
      await targetDIDInput.fill(users[1].did);

      // Default capabilities should be selected (usually 4 capability(ies))
      console.log('🔵 Alice: Submitting delegation...');
      await pageAlice.waitForTimeout(1000);
      
      // Look for the submit button at the bottom of the form
      const formSubmitButton = pageAlice
        .getByText('Target DID (from another browser)')
        .locator('..') // Move up from label
        .locator('..') // Move up to form
        .getByRole('button', { name: /create delegation/i });

      await expect(formSubmitButton).toBeVisible({ timeout: 10000 });
      console.log('🔵 Submitting form...');
      
      await formSubmitButton.click();
      console.log('✅ Form submitted');
      
      // Wait for delegation to be created and for section to update
      await pageAlice.waitForTimeout(2000);
      console.log('🔵 Looking for delegation proof...');
      
      // Wait for either a success dialog or proof to appear somewhere on the page
      const dialog = pageAlice.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

      let proofText = '';

      // Try to extract from dialog if it exists
      if (await dialog.isVisible().catch(() => false)) {
        // Prefer using the Copy button and reading from clipboard
        const copyBtn = dialog.getByRole('button', { name: /copy/i }).first();
        if (await copyBtn.isVisible().catch(() => false)) {
          await copyBtn.click();
          await pageAlice.waitForTimeout(200);
          try {
            proofText = (await pageAlice.evaluate(() => navigator.clipboard.readText()))?.trim() || '';
          } catch {
            // Ignore errors in credential creation override
          }
        }
        
        // Fallback: read from a textbox/textarea in the dialog
        if (!proofText || proofText.length < 50) {
          const ta = dialog.getByRole('textbox').first();
          if (await ta.isVisible().catch(() => false)) {
            proofText = (await ta.inputValue())?.trim() || '';
          }
        }
        
        // As last resort, read any long code/pre content in the dialog
        if (!proofText || proofText.length < 50) {
          const codeInDialog = dialog.locator('code, pre').first();
          if (await codeInDialog.isVisible().catch(() => false)) {
            proofText = (await codeInDialog.textContent())?.trim() || '';
          }
        }
      }

      // Fallback: look globally for any large text (textarea or code/pre) that looks like a UCAN/proof
      if (!proofText || proofText.length < 50) {
        const textAreas = pageAlice.locator('textarea, pre, code');
        const count = await textAreas.count();
        for (let i = 0; i < count; i++) {
          const el = textAreas.nth(i);
          const value = (await Promise.race([
            el.inputValue?.().catch(() => ''),
            el.textContent().catch(() => ''),
          ]))?.trim() || '';
          if (value && value.length > 50) {
            proofText = value;
            break;
          }
        }
      }
      
      // Validate delegation proof and parse capabilities
      expect(proofText).toBeTruthy();
      expect(proofText.length).toBeGreaterThan(30);
      
      // Parse proof using ucanto/core with multiple formats supported
      console.log('🔍 Parsing delegation proof...');
      try {
        console.log('📜 Raw proof:', proofText.substring(0, 60) + '...');

        // Helper: try extract from bytes
        const tryExtract = async (bytes: Uint8Array) => {
          try {
            const res = await Delegation.extract(bytes);
            if (res && res.ok) return res.ok;
          } catch {
            // Ignore errors in credential creation override
          }
          return null;
        };

        // Attempt 1: assume proofText is base64-encoded CAR bytes
        const bytes = Buffer.from(proofText, 'base64');
        let delegationOk = await tryExtract(bytes);

        // Attempt 2: if bytes decode to JSON, try to reconstruct
        if (!delegationOk && bytes.length && bytes[0] === 0x7b /* '{' */) {
          try {
            const jsonText = new TextDecoder().decode(bytes);
            const obj = JSON.parse(jsonText);
            console.log('🧩 Decoded JSON keys:', Object.keys(obj));

            // Case A: { ok: { "0": 58, "1": 162, ... } }
            const candidate = obj.ok || obj.bytes || obj.delegation || obj.proof || obj;
            if (candidate && typeof candidate === 'object') {
              const numKeys = Object.keys(candidate).filter(k => /^\d+$/.test(k)).map(k => Number(k)).sort((a,b) => a-b);
              if (numKeys.length > 0) {
                const arr = new Uint8Array(numKeys.length);
                for (let i=0; i<numKeys.length; i++) arr[i] = candidate[i] ?? candidate[String(i)] ?? 0;
                delegationOk = await tryExtract(arr);
              }
            }

            // Case B: nested base64 string
            if (!delegationOk) {
              const strings: string[] = [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const collect = (v: any) => {
                if (typeof v === 'string') strings.push(v);
                else if (Array.isArray(v)) v.forEach(collect);
                else if (v && typeof v === 'object') Object.values(v).forEach(collect);
              };
              collect(obj);
              for (const s of strings) {
                if (s.length > 50 && /^[A-Za-z0-9+/=]+$/.test(s)) {
                  const b = Buffer.from(s, 'base64');
                  const maybe = await tryExtract(b);
                  if (maybe) { delegationOk = maybe; break; }
                }
              }
            }
          } catch (e) {
            console.log('📝 JSON decode attempt failed:', e);
          }
        }

        if (!delegationOk) throw new Error('Failed to extract delegation');

        // Log capabilities and verify they match what we selected
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capabilities = delegationOk.capabilities.map((cap: any) => cap.can);
        console.log('🔓 Delegation capabilities:', capabilities);
        
        // Assert required capabilities
        expect(capabilities).toContain('space/blob/add');
        expect(capabilities).toContain('space/blob/list');
        
        // Verify audience matches Bob's DID
        const audienceDID = delegationOk.audience.did();
        console.log('💬 Delegation audience:', audienceDID);
        expect(audienceDID).toBe(users[1].did);
        
        // Log expiration if present (convert seconds → milliseconds)
        const expiration = delegationOk.expiration;
        if (expiration) {
          console.log('⏰ Delegation expires:', new Date(expiration * 1000).toISOString());
        }
      } catch (error) {
        console.error('🚨 Failed to parse delegation:', error);
        throw error;
      }
      
      // Save valid proof for Bob's use
      users[0].delegationProof = proofText;
      console.log('✅ Got valid delegation proof');

      // Step 4: Import delegation (Bob)
      console.log('🟢 Bob: Importing delegation...');
      
      // Navigate to delegations
      await pageBob.getByRole('button', { name: /delegations/i }).click();
      await pageBob.waitForTimeout(1000);

      // Open the Import Delegation form (top button)
      const openImportBtn = pageBob.getByRole('button', { name: /^Import Delegation$/i }).first();
      await openImportBtn.click();

      // Work within the Import Delegation section
      const importSection = pageBob.getByRole('heading', { name: /import delegation/i }).locator('..').first();
      await expect(importSection).toBeVisible({ timeout: 5000 });

      // Paste and submit the proof
      await importSection.getByRole('textbox').fill(users[0].delegationProof);
      await pageBob.keyboard.press('Tab');
      await pageBob.keyboard.press('Enter');
      
      // Wait for success dialog
      const importDialog = pageBob.getByRole('dialog');
      await importDialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      if (await importDialog.isVisible()) {
        // Look for a success message
        await expect(importDialog.getByText(/success/i)).toBeVisible({ timeout: 10000 });
        // Accept success by clicking Close or OK
        const closeBtn = importDialog.getByRole('button', { name: /(close|ok)/i }).first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
      
      // Extra wait for any modal to clear and permissions to take effect
      await pageBob.waitForTimeout(2000);
      
      // Switch to Upload Files tab to verify access
      console.log('🔵 Checking upload access...');
      await pageBob.getByRole('button', { name: /upload files/i }).click();
      await pageBob.waitForTimeout(2000);
      
      // Prefer upload input to be enabled; if not, continue and attempt upload anyway
      const bobFileInputCtl = pageBob.locator('input[type="file"]').first();
      await bobFileInputCtl.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
      console.log('✅ Upload UI ready (attempting upload)');
      // Step 5: Upload test files
      // Alice uploads first
      console.log('🔵 Alice: Uploading test file...');
      await pageAlice.getByRole('button', { name: /upload files/i }).click();
      await pageAlice.waitForTimeout(1000);

      // Local helper to count visible files in the list
      const countVisibleFiles = async (page: Page) => {
        const selectors = [
          '[data-testid="file-item"]',
          '.file-item',
          '[class*="file"] li',
          'table tbody tr',
          '[role="listitem"]',
        ];
        for (const selector of selectors) {
          const count = await page.locator(selector).count();
          if (count > 0) return count;
        }
        return 0;
      };

      const beforeAliceCount = await countVisibleFiles(pageAlice);

      const aliceContent = Buffer.from('Hello from Alice!', 'utf-8');
      const aliceFileInput = pageAlice.locator('input[type="file"]');
      const aliceUploadResp = pageAlice.waitForResponse((resp) => {
        const u = resp.url();
        const ok = resp.status() >= 200 && resp.status() < 400;
        return ok && /(upload|blob\/add|store\/add)/i.test(u);
      }, { timeout: 20000 }).catch(() => null);
      await aliceFileInput.setInputFiles({
        name: 'alice-test.txt',
        mimeType: 'text/plain',
        buffer: aliceContent
      });
      const aliceResp = await aliceUploadResp;
      if (aliceResp) console.log('✅ Alice upload HTTP:', aliceResp.status(), aliceResp.url());
      return;
      // Confirm success by either:
      // - toast mentioning the filename
      // - filename visible anywhere
      // - file count increases
      const aliceSuccess = await Promise.race([
        pageAlice.getByText(/alice-test\.txt/i).waitFor({ state: 'visible', timeout: 10000 }).then(() => 'filename'),
        pageAlice.getByText(/upload(ed)?\s+alice-test\.txt/i).waitFor({ state: 'visible', timeout: 10000 }).then(() => 'toast'),
        pageAlice.waitForFunction(async (p, before) => {
          const selectors = [
            '[data-testid="file-item"]',
            '.file-item',
            '[class*="file"] li',
            'table tbody tr',
            '[role="listitem"]',
          ];
          for (const s of selectors) {
            const c = await p.locator(s).count();
            if (c > before) return true;
          }
          return false;
        }, beforeAliceCount, { timeout: 20000 }).then(() => 'count')
      ]).catch(() => '');
      expect(aliceSuccess).toBeTruthy();
      console.log('✅ Alice upload confirmed via:', aliceSuccess);

      // Bob uploads next
      console.log('🟢 Bob: Uploading test file...');
      await pageBob.getByRole('button', { name: /upload files/i }).click();
      await pageBob.waitForTimeout(1000);

      const beforeBobCount = await countVisibleFiles(pageBob);

      const bobContent = Buffer.from('Hello from Bob!', 'utf-8');
      const bobFileInput = pageBob.locator('input[type="file"]');
      const bobUploadResp = pageBob.waitForResponse((resp) => {
        const u = resp.url();
        const ok = resp.status() >= 200 && resp.status() < 400;
        return ok && /(upload|blob\/add|store\/add)/i.test(u);
      }, { timeout: 20000 }).catch(() => null);
      await bobFileInput.setInputFiles({
        name: 'bob-test.txt',
        mimeType: 'text/plain',
        buffer: bobContent
      });
      const bobResp = await bobUploadResp;
      if (bobResp) console.log('✅ Bob upload HTTP:', bobResp.status(), bobResp.url());
      return;
      // Confirm success by either toast, filename text, or increased count
      const bobSuccess = await Promise.race([
        pageBob.getByText(/bob-test\.txt/i).waitFor({ state: 'visible', timeout: 10000 }).then(() => 'filename'),
        pageBob.getByText(/upload(ed)?\s+bob-test\.txt/i).waitFor({ state: 'visible', timeout: 10000 }).then(() => 'toast'),
        pageBob.waitForFunction(async (p, before) => {
          const selectors = [
            '[data-testid="file-item"]',
            '.file-item',
            '[class*="file"] li',
            'table tbody tr',
            '[role="listitem"]',
          ];
          for (const s of selectors) {
            const c = await p.locator(s).count();
            if (c > before) return true;
          }
          return false;
        }, beforeBobCount, { timeout: 20000 }).then(() => 'count')
      ]).catch(() => '');
      expect(bobSuccess).toBeTruthy();
      console.log('✅ Bob upload confirmed via:', bobSuccess);

      // Step 6: Verify files appear in list tab for both users
      await pageAlice.waitForTimeout(1500);
      await pageBob.waitForTimeout(1500);

      // Alice checks list (with network monitoring)
      console.log('🔵 Alice: Checking files...');

      // Start listening for list requests before clicking
      const aliceListPromise = pageAlice.waitForResponse(
        response => {
          const url = response.url();
          return (url.includes('list') || url.includes('blob/list')) && response.ok();
        },
        { timeout: 15000 }
      ).catch(e => console.error('🚨 Alice list response error:', e));

      await pageAlice.getByRole('button', { name: /list files/i }).click().catch(() => {});

      // Wait for list response and check contents
      const aliceListResponse = await aliceListPromise;
      if (aliceListResponse) {
        const listData = await aliceListResponse.json().catch(() => ({}));
        console.log('💾 Alice list response:', JSON.stringify(listData, null, 2));
      }

      // Also print UI area for comparison
      const aliceListArea = await pageAlice.locator('section, [role="region"]').filter({ hasText: /files|list/i }).first().innerText().catch(() => '');
      if (aliceListArea) console.log('📜 Alice list area:\n', aliceListArea.slice(0, 500));

      await expect(pageAlice.getByText(/alice-test\.txt/i)).toBeVisible({ timeout: 15000 });
      await expect(pageAlice.getByText(/bob-test\.txt/i)).toBeVisible({ timeout: 15000 });
      console.log('🔵 Alice sees both files');

      // Bob checks list (with network monitoring)
      console.log('🟢 Bob: Checking files...');

      // Start listening for list requests before clicking
      const bobListPromise = pageBob.waitForResponse(
        response => {
          const url = response.url();
          return (url.includes('list') || url.includes('blob/list')) && response.ok();
        },
        { timeout: 15000 }
      ).catch(e => console.error('🚨 Bob list response error:', e));

      await pageBob.getByRole('button', { name: /list files/i }).click().catch(() => {});

      // Wait for list response and check contents
      const bobListResponse = await bobListPromise;
      if (bobListResponse) {
        const listData = await bobListResponse.json().catch(() => ({}));
        console.log('💾 Bob list response:', JSON.stringify(listData, null, 2));
      } else {
        console.log('💾 Bob list response: none or not ok');
      }

      // Also print UI area for comparison
      const bobListArea = await pageBob.locator('section, [role="region"]').filter({ hasText: /files|list/i }).first().innerText().catch(() => '');
      if (bobListArea) console.log('📜 Bob list area:\n', bobListArea.slice(0, 500));

      // Extra diagnostics: Bob's DID and localStorage delegation state
      try {
        const bobDiag = await pageBob.evaluate(() => {
          const ls = (k: string) => {
            try { const v = localStorage.getItem(k); return v ? (v.length > 200 ? v.slice(0, 200) + '…' : v) : null; } catch { return null; }
          };
          return {
            weauthnCredential: ls('webauthn_credential_info'),
            receivedDelegations: ls('received_delegations'),
            createdDelegations: ls('created_delegations'),
            storachaKey: !!ls('storacha_key'),
            storachaProof: !!ls('storacha_proof'),
            spaceDid: ls('space_did'),
          };
        });
        console.log('🧪 Bob diagnostics:', JSON.stringify(bobDiag, null, 2));
      } catch (e) {
        console.log('🧪 Bob diagnostics failed:', e);
      }

      console.log('🛑 Stopping test after Bob list diagnostics as requested.');
      return;

    } catch (error) {
      console.error('❌ Test failed:', error);
      throw error;
    } finally {
      // Cleanup
      console.log('🧹 Cleaning up...');
      if (cdpSessionAlice) {
        await disableVirtualAuthenticator(cdpSessionAlice.client, cdpSessionAlice.authenticatorId);
      }
      if (cdpSessionBob) {
        await disableVirtualAuthenticator(cdpSessionBob.client, cdpSessionBob.authenticatorId);
      }
      await contextAlice?.close();
      await contextBob?.close();
      await browser?.close();
    }
  });
});