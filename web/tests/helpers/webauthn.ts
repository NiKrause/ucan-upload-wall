import { BrowserContext, CDPSession } from '@playwright/test';

/**
 * Enable virtual WebAuthn authenticator for testing
 * This allows WebAuthn to work in headless/automated mode
 */
export async function enableVirtualAuthenticator(context: BrowserContext) {
  // Get all pages in the context
  const pages = context.pages();
  if (pages.length === 0) {
    throw new Error('No pages available in context');
  }

  // Use the first page to create CDP session
  const page = pages[0];
  const client = await context.newCDPSession(page);

  // Enable WebAuthn
  await client.send('WebAuthn.enable');

  // Add a virtual authenticator
  const authenticatorId = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      ctap2Version: 'ctap2_1',
      hasPrf: true,
    },
  });

  console.log('✅ Virtual WebAuthn authenticator enabled:', authenticatorId);
  
  return { client, authenticatorId: authenticatorId.authenticatorId };
}

/**
 * Disable virtual authenticator (cleanup)
 */
export async function disableVirtualAuthenticator(
  client: CDPSession,
  authenticatorId: string
) {
  try {
    await client.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId,
    });
    await client.send('WebAuthn.disable');
    console.log('✅ Virtual WebAuthn authenticator disabled');
  } catch (error) {
    console.warn('⚠️ Error disabling virtual authenticator:', error);
  }
}
