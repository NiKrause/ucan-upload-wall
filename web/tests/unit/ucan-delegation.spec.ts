import { test, expect } from '@playwright/test';
import { UCANDelegationService } from '../src/lib/ucan-delegation';

test.describe('UCANDelegationService Unit Tests', () => {
  let service: UCANDelegationService;

  test.beforeEach(async ({ page }) => {
    // Navigate to a blank page to ensure we have a valid origin for localStorage
    await page.goto('http://localhost:4173/');

    // Inject the module
    await page.addScriptTag({ type: 'module', content: `
      import { UCANDelegationService } from '/src/lib/ucan-delegation.ts';
      window.UCANDelegationService = UCANDelegationService;
    ` });

    // Expose necessary classes to the browser context
    await page.evaluate(async () => {
      // Mock local storage if needed or rely on the isolated context
      localStorage.clear();
    });

    // We can't directly instantiate the class in Node context if it uses DOM APIs immediately
    // Instead, we'll run the logic inside the browser context using page.evaluate
  });

  test('validateDelegation: should correctly validate expiration', async ({ page }) => {
    // Wait for module to be available (basic check)
    await page.waitForFunction(() => typeof window.UCANDelegationService !== 'undefined');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const service = new window.UCANDelegationService();
      
      // Create a mock expired delegation
      const expiredDelegation = {
        id: 'expired',
        fromIssuer: 'did:key:z123',
        toAudience: 'did:key:z456',
        proof: 'mock',
        capabilities: [],
        createdAt: new Date(Date.now() - 20000).toISOString(),
        expiresAt: new Date(Date.now() - 10000).toISOString(),
        revoked: false
      };
      
      const futureDelegation = {
        id: 'valid',
        fromIssuer: 'did:key:z123',
        toAudience: 'did:key:z456',
        proof: 'mock',
        capabilities: [],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        revoked: false
      };

      const resExpired = await service.validateDelegation(expiredDelegation);
      const resValid = await service.validateDelegation(futureDelegation);

      return { resExpired, resValid };
    });

    expect(result.resExpired.valid).toBe(false);
    expect(result.resExpired.reason).toMatch(/expired/i);
    expect(result.resValid.valid).toBe(true);
  });

  test('isDelegationRevoked: should return true if revocation is cached', async ({ page }) => {
    // Wait for module to be available
    await page.waitForFunction(() => typeof window.UCANDelegationService !== 'undefined');

    const result = await page.evaluate(async () => {
      // @ts-ignore
      const service = new window.UCANDelegationService();
      const cid = 'bafytest...';
      
      // Manually set cache
      localStorage.setItem('revocation_cache', JSON.stringify({
        [cid]: { revoked: true, checkedAt: Date.now() }
      }));

      return await service.isDelegationRevoked(cid);
    });

    expect(result).toBe(true);
  });
});
