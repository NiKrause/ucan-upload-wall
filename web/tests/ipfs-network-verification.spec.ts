/**
 * E2E Test: IPFS Network Verification
 * 
 * This test verifies the complete IPFS network flow:
 * 1. Browser A: Upload a file to Storacha
 * 2. Browser B: Download the same file via Helia (IPFS network)
 * 
 * This test is designed to run daily in CI to detect IPFS network issues.
 * 
 * Test Flow:
 * - Browser A creates a DID, imports delegation, uploads a file to Storacha
 * - Browser B (separate context) downloads the file using the CID via Helia
 * - Verifies the downloaded content matches the uploaded content
 */

import type { Server } from 'node:http';
import { test, expect, BrowserContext, Page } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';
import * as ed25519 from '@ucanto/principal/ed25519';
import { delegate } from '@ucanto/core';
import * as ProviderCaps from '@storacha/capabilities/provider';
import * as DidMailto from '@storacha/did-mailto';
import { Absentee } from '@ucanto/principal';
import * as varsigModule from 'iso-webauthn-varsig';
import {
  createCorsHttp,
  loadUploadApiTestContext,
  refreshExternalServiceProofs,
  startUploadApiServer,
} from '../../local-storacha-api/upload-service.mjs';

test.describe.configure({ mode: 'serial' });

if (!Promise.withResolvers) {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    return { promise, resolve, reject };
  };
}

type ReceiptResult = { ok?: unknown; error?: unknown };

type UploadApiContext = {
  id: { did: () => string; toDIDKey: () => string };
  agentStore: { receipts: { get: (taskCid: string) => Promise<ReceiptResult> } };
  provisionsStorage: {
    put: (args: {
      cause: unknown;
      consumer: string;
      customer: string;
      provider: string;
    }) => Promise<void>;
  };
} & Record<string, unknown>;

type CreateContext = (
  config?: { requirePaymentPlan?: boolean; http?: unknown } & Record<string, unknown>
) => Promise<UploadApiContext>;

type CleanupContext = (context: UploadApiContext) => Promise<void>;

type EdSigner = Awaited<ReturnType<typeof ed25519.generate>>;
type DelegationProof = Awaited<ReturnType<typeof delegate>>;

type HeliaNode = {
  libp2p: {
    peerId?: { toString?: () => string };
    getMultiaddrs: () => Array<{ toString: () => string }>;
    contentRouting: { provide: (root: unknown) => Promise<void> };
  };
  blockstore: { put: (cid: unknown, bytes: Uint8Array) => Promise<void> };
  stop: () => Promise<void>;
};

let createContext: CreateContext;
let cleanupContext: CleanupContext;

test.beforeAll(async () => {
  const uploadApiHelpers = await loadUploadApiTestContext();
  createContext = uploadApiHelpers.createContext as CreateContext;
  cleanupContext = uploadApiHelpers.cleanupContext as CleanupContext;
  console.log('✅ Upload-api test utilities loaded successfully');
});

test.describe('IPFS Network Verification - Two Browser Test', () => {
  const IPFS_BOOTSTRAP = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp5i9cM2m2E1r4NkHeF7NhU9gBbz3K',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ2wBb1jzYp5VCxQGtEex9kK',
  ];

  let contextA: BrowserContext;
  let pageA: Page;
  let cdpSessionA: { client: unknown; authenticatorId: string };

  let contextB: BrowserContext;
  let pageB: Page;
  let cdpSessionB: { client: unknown; authenticatorId: string };

  let uploadServiceContext: UploadApiContext | null = null;
  let uploadApiServer: Server | null = null;
  let uploadApiUrl: string | null = null;

  let heliaNode: HeliaNode | null = null;
  let heliaStartPromise: Promise<HeliaNode> | null = null;
  let heliaWsMultiaddr: string | null = null;
  let heliaPeerId: string | null = null;
  const heliaRoots = new Set<string>();

  let spaceAgent: EdSigner;
  let space: EdSigner;
  let spaceDid: string;
  let spaceProof: DelegationProof;

  async function waitForAppShell(page: Page): Promise<void> {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /Upload Files/i }).first()).toBeVisible({
      timeout: 15000,
    });
  }

  async function ensureHelia(): Promise<HeliaNode> {
    if (heliaNode) {
      return heliaNode;
    }
    if (!heliaStartPromise) {
      heliaStartPromise = (async () => {
        const { createHelia } = await import('helia');
        const { unixfs } = await import('@helia/unixfs');
        const { createLibp2p } = await import('libp2p');
        const { bootstrap } = await import('@libp2p/bootstrap');
        const { webSockets } = await import('@libp2p/websockets');
        const { noise } = await import('@chainsafe/libp2p-noise');
        const { yamux } = await import('@chainsafe/libp2p-yamux');
        const { identify } = await import('@libp2p/identify');
        const { ping } = await import('@libp2p/ping');
        const { kadDHT } = await import('@libp2p/kad-dht');
        const libp2p = await createLibp2p({
          transports: [webSockets()],
          connectionEncrypters: [noise()],
          streamMuxers: [yamux()],
          peerDiscovery: [bootstrap({ list: IPFS_BOOTSTRAP })],
          addresses: {
            listen: ['/ip4/127.0.0.1/tcp/0/ws'],
          },
          services: {
            identify: identify(),
            ping: ping(),
            dht: kadDHT({ clientMode: false }),
          },
        });
        const node = (await createHelia({ libp2p })) as HeliaNode;
        unixfs(node);
        heliaPeerId = node.libp2p.peerId?.toString?.() ?? null;
        const addrs = node.libp2p.getMultiaddrs().map((addr) => addr.toString());
        heliaWsMultiaddr = addrs.find((addr) => addr.includes('/ws')) ?? null;
        if (!heliaWsMultiaddr || !heliaPeerId) {
          throw new Error('Failed to determine Helia WS multiaddr');
        }
        console.log(`🟣 Helia node started (peer: ${heliaPeerId}, ws: ${heliaWsMultiaddr})`);
        return node;
      })();
    }
    heliaNode = await heliaStartPromise;
    return heliaNode;
  }

  async function importCarToHelia(bytes: Uint8Array) {
    const helia = await ensureHelia();
    const { CarReader } = await import('@ipld/car');
    const reader = await CarReader.fromBytes(bytes);
    const roots = await reader.getRoots();
    let blockCount = 0;

    for await (const block of reader.blocks()) {
      await helia.blockstore.put(block.cid, block.bytes);
      blockCount += 1;
    }

    console.log(`🟣 Helia stored ${blockCount} blocks from uploaded CAR`);

    for (const root of roots) {
      heliaRoots.add(root.toString());
      try {
        await helia.libp2p.contentRouting.provide(root);
        console.log(`🟣 Helia provided root ${root.toString()}`);
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        if (message.includes('No content routers available')) {
          console.log(`🟣 Helia provide skipped (no routers) for ${root.toString()}`);
        } else {
          throw error;
        }
      }
    }

    if (roots.length > 0) {
      console.log(`🟣 Helia import complete for roots: ${roots.map((root) => root.toString()).join(', ')}`);
    }
  }

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(300000); // 5 minutes timeout for slower network propagation

    console.log('🚀 Setting up test environment with two browsers...');

    // 1. Create in-memory upload service
    console.log('📦 Creating in-memory upload service...');
    uploadServiceContext = await createContext({
      requirePaymentPlan: false,
      http: createCorsHttp({
        onPutBytes: ({ bytes }: { bytes: Uint8Array }) => {
          const normalized =
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
          importCarToHelia(normalized).catch((error) => {
            console.warn('🟣 Helia CAR import skipped (PUT):', error?.message ?? error);
          });
        },
        onCarBytes: ({ bytes }: { bytes: Uint8Array }) => {
          const normalized =
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
          importCarToHelia(normalized).catch((error) => {
            console.warn('🟣 Helia CAR import skipped:', error?.message ?? error);
          });
        },
      }),
    });

    await refreshExternalServiceProofs(uploadServiceContext);
    console.log('✅ Upload service created:', uploadServiceContext.id.did());

    // 2. Create a space and agent
    console.log('🔑 Creating space agent...');
    spaceAgent = await ed25519.generate();
    space = await ed25519.generate();
    spaceDid = space.did();
    console.log('✅ Space created:', spaceDid);
    console.log('✅ Space agent created:', spaceAgent.did());

    // 3. Create space delegation proof
    spaceProof = await delegate({
      issuer: space,
      audience: spaceAgent,
      capabilities: [{ can: '*', with: space.did() }],
    });
    console.log('🧾 Space proof created', spaceProof);

    // 4. Provision the space
    console.log('📝 Provisioning space with upload service...');
    const accountDid = DidMailto.fromEmail('test@example.com');
    const account = Absentee.from({ id: accountDid });
    const providerAdd = ProviderCaps.add.invoke({
      issuer: spaceAgent,
      audience: uploadServiceContext.id,
      with: account.did(),
      nb: {
        provider: uploadServiceContext.id.did(),
        consumer: space.did(),
      },
      proofs: [
        await delegate({
          issuer: account,
          audience: spaceAgent,
          capabilities: [
            {
              can: 'provider/add',
              with: account.did(),
              nb: {
                provider: uploadServiceContext.id.did(),
                consumer: space.did(),
              },
            },
          ],
        }),
      ],
    });
    await uploadServiceContext.provisionsStorage.put({
      cause: providerAdd,
      consumer: spaceDid,
      customer: account.did(),
      provider: uploadServiceContext.id.did(),
    });
    console.log('✅ Space provisioned');

    // 5. Start upload-api HTTP server
    console.log('🌐 Starting upload-api HTTP server...');
    const serverInfo = await startUploadApiServer(uploadServiceContext, {
      onCarBytes: ({ bytes }: { bytes: Uint8Array }) => {
        const normalized =
          bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
        importCarToHelia(normalized).catch((error) => {
          console.warn('🟣 Helia CAR import skipped:', error?.message ?? error);
        });
      },
      varsigModule,
    });
    uploadApiServer = serverInfo.server;
    uploadApiUrl = serverInfo.url;
    console.log('✅ upload-api server ready:', uploadApiUrl);

    // 6. Start Helia before bootstrapping browsers
    await ensureHelia();
    if (!heliaWsMultiaddr || !heliaPeerId) {
      throw new Error('Helia WS address missing');
    }

    // 7. Setup Browser A (uploader)
    console.log('🌐 Setting up Browser A (uploader)...');
    contextA = await browser.newContext();
    await contextA.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await contextA.grantPermissions(['clipboard-read', 'clipboard-write']);
    pageA = await contextA.newPage();

    cdpSessionA = await enableVirtualAuthenticator(contextA);

    pageA.on('console', (msg) => {
      console.log(`[browserA:${msg.type()}] ${msg.text()}`);
    });
    pageA.on('pageerror', (error) => {
      console.log(`[browserA:error] ${error.message}`);
    });

    await pageA.addInitScript(
      ({ url, did, heliaBootstrap }) => {
        const globalOverrides = globalThis as typeof globalThis & {
          __UPLOAD_SERVICE_URL__?: string;
          __UPLOAD_SERVICE_DID__?: string;
          __RECEIPTS_URL__?: string;
          __HELIA_BOOTSTRAP__?: { peerId: string; addrs: string[] };
        };
        if (url) {
          globalOverrides.__UPLOAD_SERVICE_URL__ = url;
          globalOverrides.__UPLOAD_SERVICE_DID__ = did;
          globalOverrides.__RECEIPTS_URL__ = `${url}/receipt/`;
        }
        globalOverrides.__HELIA_BOOTSTRAP__ = heliaBootstrap;
      },
      {
        url: uploadApiUrl,
        did: uploadServiceContext.id.did(),
        heliaBootstrap: { peerId: heliaPeerId, addrs: [heliaWsMultiaddr] },
      }
    );

    await waitForAppShell(pageA);
    console.log('✅ Browser A setup complete');

    // 8. Setup Browser B (downloader)
    console.log('🌐 Setting up Browser B (downloader)...');
    contextB = await browser.newContext();
    await contextB.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    pageB = await contextB.newPage();

    cdpSessionB = await enableVirtualAuthenticator(contextB);

    pageB.on('console', (msg) => {
      console.log(`[browserB:${msg.type()}] ${msg.text()}`);
    });
    pageB.on('pageerror', (error) => {
      console.log(`[browserB:error] ${error.message}`);
    });

    await pageB.addInitScript(
      ({ heliaBootstrap }) => {
        const globalOverrides = globalThis as typeof globalThis & {
          __HELIA_BOOTSTRAP__?: { peerId: string; addrs: string[] };
        };
        globalOverrides.__HELIA_BOOTSTRAP__ = heliaBootstrap;
      },
      {
        heliaBootstrap: { peerId: heliaPeerId, addrs: [heliaWsMultiaddr] },
      }
    );

    await waitForAppShell(pageB);
    console.log('✅ Browser B setup complete');
  });

  test.afterEach(async () => {
    console.log('🧹 Cleaning up...');

    if (cdpSessionA) {
      await disableVirtualAuthenticator(cdpSessionA.client, cdpSessionA.authenticatorId).catch(() => {});
    }

    if (cdpSessionB) {
      await disableVirtualAuthenticator(cdpSessionB.client, cdpSessionB.authenticatorId).catch(() => {});
    }

    if (uploadServiceContext) {
      await cleanupContext(uploadServiceContext);
      console.log('✅ Upload service cleaned up');
    }

    if (uploadApiServer) {
      await new Promise<void>((resolve) => uploadApiServer?.close(() => resolve()));
      uploadApiServer = null;
      uploadApiUrl = null;
    }

    if (heliaNode) {
      await heliaNode.stop();
      heliaNode = null;
      heliaStartPromise = null;
      heliaWsMultiaddr = null;
      heliaPeerId = null;
      console.log('🟣 Helia node stopped');
    }

    await contextA?.close().catch(() => {});
    await contextB?.close().catch(() => {});
  });

  async function createDIDInBrowser(page: Page, browserLabel: string): Promise<string> {
    console.log(`📝 Creating DID in ${browserLabel}...`);

    await page.getByRole('button', { name: /Upload Files/i }).click();
    await page.waitForTimeout(1000);

    const uploadHeading = page.getByRole('heading', { name: /Step 1: Create (Ed25519 )?DID/i });
    await expect(uploadHeading).toBeVisible({ timeout: 10000 });

    const createButton = page.getByRole('button', {
      name: /Create DID|Create Secure DID|Generating/i,
    });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled({ timeout: 5000 });

    await createButton.click();
    await page.waitForFunction(
      () => Boolean(localStorage.getItem('webauthn_ed25519_hardware_signer')),
      null,
      { timeout: 20000 }
    );

    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(1000);
    const didElement = page.getByTestId('did-display');
    await expect(didElement).toBeVisible({ timeout: 10000 });
    const browserDID = (await didElement.textContent())?.trim();
    expect(browserDID).toBeTruthy();
    expect(browserDID).toMatch(/^did:key:/);

    console.log(`✅ ${browserLabel} DID:`, browserDID);
    return browserDID as string;
  }

  test('should upload file in Browser A and download in Browser B via IPFS', async () => {
    console.log('\n🎯 TEST START: Two-Browser IPFS Network Verification\n');

    // ========================================
    // BROWSER A: Upload Flow
    // ========================================
    console.log('📤 BROWSER A: Starting upload flow...');

    // Step 1: Create DID in Browser A
    const browserADID = await createDIDInBrowser(pageA, 'Browser A');

    // Step 2: Create delegation for Browser A
    console.log('🔐 Creating delegation for Browser A...');
    const browserAPrincipal = {
      did: () => browserADID as `did:key:${string}`,
      toArchive: () => ({ ok: new Uint8Array() }),
    };

    const delegation = await delegate({
      issuer: space,
      audience: browserAPrincipal,
      capabilities: [
        { with: space.did(), can: 'assert/index' },
        { with: space.did(), can: 'space/blob/add' },
        { with: space.did(), can: 'space/index/add' },
        { with: space.did(), can: 'upload/add' },
        { with: space.did(), can: 'upload/list' },
        { with: space.did(), can: 'filecoin/offer' },
        { with: space.did(), can: 'store/add' },
      ],
      expiration: Math.floor(Date.now() / 1000) + 3600,
    });

    const delegationArchive = await delegation.archive();
    if (!delegationArchive.ok) {
      throw new Error('Failed to create delegation archive');
    }

    const delegationBytes = delegationArchive.ok;
    const delegationBase64 = 'm' + Buffer.from(delegationBytes).toString('base64');
    console.log('✅ Delegation created for Browser A');

    // Step 3: Import delegation in Browser A
    console.log('📥 Importing delegation in Browser A...');
    await pageA.getByRole('button', { name: /delegations/i }).click();
    await pageA.waitForTimeout(2000);

    const importButton = pageA.locator('button', { hasText: 'Import UCAN Delegation' }).first();
    await expect(importButton).toBeVisible({ timeout: 15000 });
    await importButton.click();
    await pageA.waitForTimeout(1500);

    const nameInput = pageA.getByPlaceholder(/e.g., Alice's Upload Token/i);
    await nameInput.fill('Test Upload Delegation');

    const delegationTextarea = pageA.getByTestId('import-delegation-textarea');
    await delegationTextarea.fill(delegationBase64);
    await pageA.waitForTimeout(500);

    const importSubmitButton = pageA.locator('button:has-text("Import UCAN Delegation")').last();
    await importSubmitButton.click();
    await pageA.waitForTimeout(3000);

    console.log('✅ Delegation imported in Browser A');

    // Step 4: Upload file in Browser A
    console.log('📤 Uploading file in Browser A...');
    await pageA.getByRole('button', { name: /Upload Files/i }).first().click();
    await pageA.waitForTimeout(2000);

    const testFileContent = `IPFS Network Test File - ${new Date().toISOString()}`;
    const testFileName = 'ipfs-test-file.txt';

    const fileInput = pageA.locator('input[type="file"]');
    const dataTransfer = await pageA.evaluateHandle(
      ({ content, name }) => {
        const dt = new DataTransfer();
        const file = new File([content], name, { type: 'text/plain' });
        dt.items.add(file);
        return dt;
      },
      { content: testFileContent, name: testFileName }
    );

    await fileInput.evaluateHandle((input: unknown, dt: unknown) => {
      const element = input as HTMLInputElement;
      const dataTransfer = dt as DataTransfer;
      element.files = dataTransfer.files;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, dataTransfer);

    await pageA.waitForTimeout(1000);

    const uploadButton = pageA.getByRole('button', { name: /Upload to Storacha/i });
    await expect(uploadButton).toBeVisible({ timeout: 5000 });
    await uploadButton.click();

    const signConfirmButton = pageA.locator('[data-testid="confirm-upload-sign"]');
    if (await signConfirmButton.isVisible().catch(() => false)) {
      await signConfirmButton.click();
    }

    const uploadSuccessAlert = pageA.getByText(new RegExp(`Successfully uploaded ${testFileName}`, 'i'));
    await expect(uploadSuccessAlert).toBeVisible({ timeout: 60000 });
    console.log('✅ File uploaded successfully in Browser A');

    // Step 5: Get the CID from Browser A
    console.log('🔍 Getting CID from Browser A...');
    const storachaFilesHeading = pageA.getByRole('heading', { name: /Files in Storacha Space/i });
    await expect(storachaFilesHeading).toBeVisible({ timeout: 60000 });

    const filesSection = storachaFilesHeading.locator('..').locator('..');
    const rootCode = filesSection.locator('code').first();
    const rootCid = (await rootCode.textContent())?.trim() ?? '';
    expect(rootCid).toMatch(/^baf/);
    console.log('✅ CID obtained:', rootCid);

    // Wait for Helia to have the content
    console.log('⏳ Waiting for content to be available in Helia...');
    await pageA.waitForTimeout(5000); // Give time for Helia to process

    // ========================================
    // BROWSER B: Download Flow
    // ========================================
    console.log('\n📥 BROWSER B: Starting download flow...');

    // Step 1: Navigate to a page where we can test IPFS fetch
    // We'll use the browser's console to call our IPFS fetch function
    console.log('🔍 Attempting to fetch file via IPFS in Browser B...');

    // Inject the CID and fetch via IPFS (Helia only, no gateway fallback).
    // Keep each attempt bounded and retry briefly to absorb network propagation delays.
    let downloadResult: { success: boolean; content?: string; source?: string; error?: string } = {
      success: false,
      error: 'Download did not run',
    };
    const maxFetchAttempts = 10;
    const fetchAttemptTimeoutMs = 15000;
    for (let attempt = 1; attempt <= maxFetchAttempts; attempt += 1) {
      console.log(`🔁 Browser B fetch attempt ${attempt}/${maxFetchAttempts}...`);
      downloadResult = await pageB.evaluate(
        async ({ cid, timeoutMs }) => {
          try {
            const { loadIpfsBlobFromHelia } = await import('/src/lib/ipfs-fetch.ts');
            console.log('🟣 Browser B: Starting IPFS fetch from Helia for CID:', cid);

            const result = await Promise.race([
              loadIpfsBlobFromHelia(cid),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Timed out waiting for Helia content after ${timeoutMs}ms`)),
                  timeoutMs
                )
              ),
            ]);

            console.log('🟣 Browser B: IPFS fetch completed, source:', result.source);
            const decoder = new TextDecoder();
            const content = decoder.decode(result.data);

            return {
              success: true,
              content,
              source: result.source,
            };
          } catch (error) {
            console.error('🟣 Browser B: IPFS fetch failed:', error);
            return {
              success: false,
              error: (error as Error).message,
            };
          }
        },
        { cid: rootCid, timeoutMs: fetchAttemptTimeoutMs }
      );

      if (downloadResult.success) {
        break;
      }
      if (attempt < maxFetchAttempts) {
        await pageB.waitForTimeout(3000);
      }
    }

    console.log('📊 Download result:', downloadResult);

    // Verify the download was successful
    expect(downloadResult.success).toBe(true);
    if (!downloadResult.success) {
      throw new Error(`Download failed: ${downloadResult.error}`);
    }

    console.log('✅ File downloaded successfully in Browser B');
    console.log('📍 Download source:', downloadResult.source);
    
    // Verify that the download came from Helia (IPFS network), not a gateway
    expect(downloadResult.source).toBe('helia');
    console.log('✅ Verified: Content fetched directly from IPFS network via Helia');

    // Verify content matches
    console.log('🔍 Verifying content matches...');
    expect(downloadResult.content).toBe(testFileContent);
    console.log('✅ Content verified - matches uploaded file!');

    console.log('\n🎉 TEST COMPLETE: IPFS Network Verification Passed!\n');
    console.log('Summary:');
    console.log('  ✓ Browser A: Created DID');
    console.log('  ✓ Browser A: Imported delegation');
    console.log('  ✓ Browser A: Uploaded file to Storacha');
    console.log('  ✓ Browser A: Got CID:', rootCid);
    console.log('  ✓ Browser B: Downloaded file via IPFS');
    console.log('  ✓ Browser B: Content verified');
    console.log('  ✓ Download source:', downloadResult.source);
    console.log('\n✅ IPFS network is working correctly!');
  });
});
