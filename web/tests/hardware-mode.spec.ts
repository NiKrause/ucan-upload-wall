import { test, expect, BrowserContext, Page } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';

type HardwareSignerSeed = {
  did: string;
  algorithm: 'Ed25519' | 'P-256';
  publicKeyHex: string;
  credentialIdBase64: string;
};

const HARDWARE_SIGNER_KEY = 'webauthn_ed25519_hardware_signer';

async function seedHardwareSigner(page: Page, seed: HardwareSignerSeed) {
  await page.evaluate(
    ({ key, payload }) => {
      localStorage.setItem(key, JSON.stringify(payload));
    },
    {
      key: HARDWARE_SIGNER_KEY,
      payload: {
        credentialId: seed.credentialIdBase64,
        did: seed.did,
        publicKey: seed.publicKeyHex,
        algorithm: seed.algorithm,
        created: new Date().toISOString(),
      },
    }
  );
}

async function openDelegations(page: Page) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Delegations', exact: true })
    .click();
  await page.waitForTimeout(500);
}

async function createDidFromUI(page: Page) {
  const createButton = page.getByTestId('create-did-button');
  const didDisplay = page.getByTestId('did-display');

  const target = await Promise.race([
    createButton.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'create'),
    didDisplay.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'did'),
  ]);

  if (target === 'create') {
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();
  }
}

async function setupContext(browser: BrowserContext['browser']): Promise<{
  context: BrowserContext;
  page: Page;
  cdp: { client: unknown; authenticatorId: string };
}> {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const cdp = await enableVirtualAuthenticator(context);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  return { context, page, cdp };
}

test.describe('Hardware mode fallbacks', () => {
  let context: BrowserContext;
  let page: Page;
  let cdp: { client: unknown; authenticatorId: string };

  test.afterEach(async () => {
    if (cdp) {
      await disableVirtualAuthenticator(
        cdp.client as Parameters<typeof disableVirtualAuthenticator>[0],
        cdp.authenticatorId
      ).catch(() => {});
    }
    await context?.close().catch(() => {});
  });

  test('uses hardware Ed25519 when available', async ({ browser }) => {
    ({ context, page, cdp } = await setupContext(browser));

    await seedHardwareSigner(page, {
      did: 'did:key:z6MkHardwareEd25519',
      algorithm: 'Ed25519',
      publicKeyHex: '11'.repeat(32),
      credentialIdBase64: btoa(String.fromCharCode(...new Uint8Array([1, 2, 3, 4]))),
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    await openDelegations(page);
    await createDidFromUI(page);

    const didDisplay = page.getByTestId('did-display');
    await expect(didDisplay).toBeVisible({ timeout: 10000 });
    await expect(didDisplay).toHaveText(/did:key:z6MkHardwareEd25519/);
    await expect(page.getByText(/Hardware Mode/i)).toBeVisible({ timeout: 10000 });
  });

  test('falls back to hardware P-256 when Ed25519 is unavailable', async ({ browser }) => {
    ({ context, page, cdp } = await setupContext(browser));

    await seedHardwareSigner(page, {
      did: 'did:key:zDnaHardwareP256',
      algorithm: 'P-256',
      publicKeyHex: '22'.repeat(65),
      credentialIdBase64: btoa(String.fromCharCode(...new Uint8Array([5, 6, 7, 8]))),
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    await openDelegations(page);
    await createDidFromUI(page);

    const didDisplay = page.getByTestId('did-display');
    await expect(didDisplay).toBeVisible({ timeout: 10000 });
    await expect(didDisplay).toHaveText(/did:key:zDnaHardwareP256/);
    await expect(page.getByText(/Hardware Mode/i)).toBeVisible({ timeout: 10000 });
  });

  test('falls back to worker mode when hardware init is disabled', async ({ browser }) => {
    ({ context, page, cdp } = await setupContext(browser));

    await page.addInitScript(() => {
      (globalThis as typeof globalThis & { __FORCE_WORKER_MODE__?: boolean }).__FORCE_WORKER_MODE__ = true;
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    await openDelegations(page);
    await createDidFromUI(page);

    await page.waitForFunction(
      () => Boolean(localStorage.getItem('ed25519_keypair')),
      null,
      { timeout: 20000 }
    );

    const didDisplay = page.getByTestId('did-display');
    await expect(didDisplay).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: /worker-based signer active/i })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/worker mode/i)).toBeVisible({ timeout: 10000 });
  });
});
