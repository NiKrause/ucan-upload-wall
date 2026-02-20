import { test, expect, BrowserContext, Page } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';

async function gotoDelegations(page: Page) {
  await page.goto('/');
  await expect(page).toHaveTitle(/UCAN Upload Wall/i);
  await expect(page.getByRole('button', { name: /delegations/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /delegations/i }).click();

  const identitySubtab = page.getByTestId('delegations-subtab-identity');
  if (await identitySubtab.count()) {
    await identitySubtab.first().click();
  }
}

test.describe('Toolkit Wiring Integration', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let page: Page;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cdpSession: { client: any; authenticatorId: string };

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await context.newPage();
    cdpSession = await enableVirtualAuthenticator(context);
  });

  test.afterEach(async () => {
    if (cdpSession) {
      await disableVirtualAuthenticator(cdpSession.client, cdpSession.authenticatorId).catch(() => {});
    }
    await context?.close().catch(() => {});
  });

  test('creates DID with real toolkit flow and persists signer state', async () => {
    test.setTimeout(60000);

    await gotoDelegations(page);

    const createButton = page.getByTestId('create-did-button').first();
    await expect(createButton).toBeVisible({ timeout: 15000 });
    await createButton.click();

    const didElement = page.getByTestId('did-display').first();
    await expect(didElement).toBeVisible({ timeout: 20000 });
    const did = await didElement.textContent();
    expect(did).toMatch(/^did:key:z/);

    await expect(page.getByText(/Worker Mode|Hardware-backed|Hardware mode/i).first()).toBeVisible({ timeout: 10000 });

    const storageSnapshot = await page.evaluate(() => {
      const raw = localStorage.getItem('webauthn_credential_info');
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        hasCredential: !!parsed,
        hasDid: typeof parsed?.did === 'string' && parsed.did.length > 0,
        hasRawCredentialId: !!parsed?.rawCredentialId,
        hasPublicKey: !!parsed?.publicKey,
        hasPrfSeed: Object.prototype.hasOwnProperty.call(parsed || {}, 'prfSeed')
      };
    });

    expect(storageSnapshot.hasCredential).toBe(true);
    expect(storageSnapshot.hasDid).toBe(true);
    expect(storageSnapshot.hasRawCredentialId).toBe(true);
    expect(storageSnapshot.hasPublicKey).toBe(true);
    expect(storageSnapshot.hasPrfSeed).toBe(false);

    await page.reload();
    await page.getByRole('button', { name: /delegations/i }).click();
    await expect(page.getByTestId('did-display').first()).toBeVisible({ timeout: 10000 });
  });
});
