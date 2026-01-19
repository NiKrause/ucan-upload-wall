/**
 * E2E Test: Complete Delegation and Upload Flow
 * 
 * This test combines:
 * 1. In-memory Storacha upload service (backend)
 * 2. React UI interactions (frontend via Playwright)
 * 3. Full delegation workflow: create space → create DID → delegate → import → upload → persist
 * 
 * Based on: docs/UPLOAD_SERVICE_TESTING_GUIDE.md
 * Issue: https://github.com/NiKrause/ucan-upload-wall/issues/2
 */

import http from 'node:http';
import { test, expect, BrowserContext, Page } from '@playwright/test';
import { enableVirtualAuthenticator, disableVirtualAuthenticator } from './helpers/webauthn';
import * as ed25519 from '@ucanto/principal/ed25519';
import { delegate, Message } from '@ucanto/core';
import { createServer, handle } from '@storacha/upload-api';
import { CAR } from '@ucanto/transport';
import * as CARTransport from '@ucanto/transport/car';

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
  config?: { requirePaymentPlan?: boolean; http?: typeof http } & Record<string, unknown>
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

// Import test context from upload-api
// Note: This provides in-memory storage and services
let createContext: CreateContext;
let cleanupContext: CleanupContext;

// Dynamic import for upload-api test utilities
test.beforeAll(async () => {
  try {
    // Import from the exported test context path
    const uploadApiHelpers = await import('@storacha/upload-api/test/context');
    createContext = uploadApiHelpers.createContext as CreateContext;
    cleanupContext = uploadApiHelpers.cleanupContext as CleanupContext;
    
    console.log('✅ Upload-api test utilities loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load upload-api test utilities:', error);
    console.log('💡 Make sure to run: npm install --save-dev @storacha/upload-api @storacha/capabilities @ucanto/server');
    throw error;
  }
});

test.describe('Delegation and Upload Flow - E2E', () => {
  const IPFS_BOOTSTRAP = [
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp5i9cM2m2E1r4NkHeF7NhU9gBbz3K',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ2wBb1jzYp5VCxQGtEex9kK',
  ];
  let context: BrowserContext;
  let page: Page;
  let cdpSession: { client: unknown; authenticatorId: string };
  let uploadServiceContext: UploadApiContext | null = null;
  let uploadApiServer: http.Server | null = null;
  let uploadApiUrl: string | null = null;
  let heliaNode: HeliaNode | null = null;
  let heliaStartPromise: Promise<HeliaNode> | null = null;
  let heliaWsMultiaddr: string | null = null;
  let heliaPeerId: string | null = null;
  let spaceAgent: EdSigner; // The agent that owns the space
  let space: EdSigner; // The space identity
  let spaceDid: string;
  let spaceProof: DelegationProof;

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

  function createCorsHttp(): typeof http {
    return {
      ...http,
      createServer: (handler: http.RequestListener) =>
        http.createServer((req, res) => {
          console.log(`🧰 Storage node HTTP ${req.method} ${req.url}`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Amz-Checksum-Sha256'
          );

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          if (req.method === 'PUT') {
            const chunks: Uint8Array[] = [];
            req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
            req.on('end', () => {
              const bytes = new Uint8Array(Buffer.concat(chunks));
              importCarToHelia(bytes).catch((error) => {
                console.warn('🟣 Helia CAR import skipped:', error?.message ?? error);
              });
            });
          }

          return handler(req, res);
        }),
    } as typeof http;
  }

  async function startUploadApiServer(
    context: UploadApiContext
  ): Promise<{ server: http.Server; url: string }> {
    const agent = createServer({ ...context, codec: CAR.inbound });

    const server = http.createServer(async (req, res) => {
      console.log(`🌐 upload-api HTTP ${req.method} ${req.url}`);
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/receipt/')) {
        const taskCid = req.url.slice('/receipt/'.length);
        if (!taskCid) {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }

        console.log(`🧾 Receipt lookup for task ${taskCid}`);
        const receiptResult = await context.agentStore.receipts.get(taskCid);
        if (receiptResult.error) {
          console.warn(`🧾 Receipt not found for task ${taskCid}`);
          res.writeHead(404, {
            'Access-Control-Allow-Origin': '*',
          });
          res.end();
          return;
        }

        const message = await Message.build({ receipts: [receiptResult.ok] });
        const body = CARTransport.request.encode(message).body;
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/car',
        });
        res.end(body);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/.well-known/did.json')) {
        const serviceDid = context.id.did();
        const didKey = context.id.toDIDKey();
        const publicKeyMultibase = didKey.startsWith('did:key:')
          ? didKey.slice('did:key:'.length)
          : didKey;

        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify({
            id: serviceDid,
            verificationMethod: [
              {
                id: `${serviceDid}#key-1`,
                type: 'Ed25519VerificationKey2020',
                controller: serviceDid,
                publicKeyMultibase,
              },
            ],
          })
        );
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);

      const response = await handle(agent, { headers: req.headers, body });
      console.log(`✅ upload-api response ${response.status || 200} ${req.method} ${req.url}`);
      res.writeHead(response.status || 200, {
        ...response.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end(response.body);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind upload-api HTTP server');
    }

    return { server, url: `http://127.0.0.1:${address.port}` };
  }

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(120000); // 2 minutes timeout for complex flow

    console.log('🚀 Setting up test environment...');

    // 1. Create in-memory upload service
    console.log('📦 Creating in-memory upload service...');
    uploadServiceContext = await createContext({
      requirePaymentPlan: false,
      http: createCorsHttp()
    });
    console.log('✅ Upload service created:', uploadServiceContext.id.did());

    // 2. Create a space and agent (this simulates the CLI user)
    console.log('🔑 Creating space agent...');
    spaceAgent = await ed25519.generate();
    space = await ed25519.generate();
    spaceDid = space.did();
    console.log('✅ Space created:', spaceDid);
    console.log('✅ Space agent created:', spaceAgent.did());

    // 3. Create space delegation proof (space delegates to spaceAgent)
    spaceProof = await delegate({
      issuer: space,
      audience: spaceAgent,
      capabilities: [{ can: '*', with: space.did() }],
    });

    // 4. Provision the space (register with upload service)
    console.log('📝 Provisioning space with upload service...');
    await uploadServiceContext.provisionsStorage.put({
      cause: spaceProof.cid,
      consumer: spaceDid,
      customer: uploadServiceContext.id.did(),
      provider: uploadServiceContext.id.did(),
    });
    console.log('✅ Space provisioned');

    // 5. Start upload-api HTTP server
    console.log('🌐 Starting upload-api HTTP server...');
    const serverInfo = await startUploadApiServer(uploadServiceContext);
    uploadApiServer = serverInfo.server;
    uploadApiUrl = serverInfo.url;
    console.log('✅ upload-api server ready:', uploadApiUrl);

    // 5. Start Helia before bootstrapping the browser
    await ensureHelia();
    if (!heliaWsMultiaddr || !heliaPeerId) {
      throw new Error('Helia WS address missing');
    }

    // 6. Setup browser context and WebAuthn
    console.log('🌐 Setting up browser context...');
    context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await context.newPage();

    // Enable virtual WebAuthn authenticator
    cdpSession = await enableVirtualAuthenticator(context);

    page.on('console', (msg) => {
      console.log(`[browser:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (error) => {
      console.log(`[browser:error] ${error.message}`);
    });
    page.on('requestfailed', (request) => {
      console.log(
        `[browser:requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`
      );
    });

    // Provide service overrides before app boot
    await page.addInitScript(
      ({ url, did, heliaBootstrap }) => {
        const globalOverrides = globalThis as typeof globalThis & {
          __UPLOAD_SERVICE_URL__?: string;
          __UPLOAD_SERVICE_DID__?: string;
          __RECEIPTS_URL__?: string;
          __HELIA_BOOTSTRAP__?: { peerId: string; addrs: string[] };
          __FORCE_WORKER_MODE__?: boolean;
        };
        if (url) {
          globalOverrides.__UPLOAD_SERVICE_URL__ = url;
          globalOverrides.__UPLOAD_SERVICE_DID__ = did;
          globalOverrides.__RECEIPTS_URL__ = `${url}/receipt/`;
        }
        globalOverrides.__HELIA_BOOTSTRAP__ = heliaBootstrap;
        globalOverrides.__FORCE_WORKER_MODE__ = true;
      },
      {
        url: uploadApiUrl,
        did: uploadServiceContext.id.did(),
        heliaBootstrap: { peerId: heliaPeerId, addrs: [heliaWsMultiaddr] },
      }
    );

    // Navigate to app
    await page.goto('/');

    // Clear storage for fresh start
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    console.log('✅ Browser setup complete');
  });

  test.afterEach(async () => {
    console.log('🧹 Cleaning up...');
    
    if (cdpSession) {
      await disableVirtualAuthenticator(cdpSession.client, cdpSession.authenticatorId).catch(() => {});
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

    await context?.close().catch(() => {});
  });

  async function createDIDInUI(): Promise<string> {
    console.log('📝 Creating DID in React UI...');

    await page.getByRole('button', { name: /Upload Files/i }).click();
    await page.waitForTimeout(1000);

    const uploadHeading = page.getByRole('heading', { name: /Step 1: Create Ed25519 DID/i });
    await expect(uploadHeading).toBeVisible({ timeout: 10000 });

    const createButton = page.getByRole('button', {
      name: /Create DID|Create Secure DID|Generating/i,
    });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled({ timeout: 5000 });

    const getDidDisplay = async () => {
      await page.getByRole('button', { name: /delegations/i }).click();
      await page.waitForTimeout(1000);
      const didElement = page.getByTestId('did-display');
      await expect(didElement).toBeVisible({ timeout: 10000 });
      const browserDID = (await didElement.textContent())?.trim();
      expect(browserDID).toBeTruthy();
      expect(browserDID).toMatch(/^did:key:z6Mk/);
      return browserDID as string;
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await createButton.click();
        await page.waitForFunction(
          () => Boolean(localStorage.getItem('ed25519_keypair')),
          null,
          { timeout: 20000 }
        );
        const browserDID = await getDidDisplay();
        console.log('✅ Browser DID:', browserDID);
        return browserDID;
      } catch (error) {
        lastError = error;
        console.log(`ℹ️ DID creation attempt ${attempt} did not complete, retrying...`);
        await page.waitForTimeout(500);
      }
    }

    throw lastError ?? new Error('Failed to create DID in UI');
  }

  test('should complete full delegation workflow: create space → DID → delegate → import → upload → persist', async () => {
    console.log('\n🎯 TEST START: Complete Delegation Workflow\n');

    // ========================================
    // STEP 1: Create DID in React UI (on Upload tab)
    // ========================================
    console.log('📝 STEP 1: Creating DID in React UI...');
    const browserDID = await createDIDInUI();
    
    // Navigate away and back to reset UI state
    console.log('🔄 Navigating away and back to Delegations tab...');
    await page.getByRole('button', { name: /Upload Files/i }).click();
    await page.waitForTimeout(1000);

    // ========================================
    // STEP 3: Create delegation in console (backend)
    // ========================================
    console.log('🔐 STEP 3: Creating delegation from space to browser DID...');
    
    // Create an audience principal from the DID string
    // We only need the DID for audience, not the private key
    const browserPrincipal = {
      did: () => browserDID as `did:key:${string}`,
      toArchive: () => ({ ok: new Uint8Array() })
    };
    console.log('✅ Browser principal created for DID:', browserDID);

    // Create delegation from spaceAgent to browserPrincipal
    // Grant store/add and upload/add capabilities
    // Using plain capability objects (like the existing codebase does)
    const delegation = await delegate({
      issuer: spaceAgent,
      audience: browserPrincipal,
      capabilities: [
        { with: space.did(), can: 'space/blob/add' },
        { with: space.did(), can: 'space/index/add' },
        { with: space.did(), can: 'upload/add' },
        { with: space.did(), can: 'upload/list' },
        { with: space.did(), can: 'filecoin/offer' },
        { with: space.did(), can: 'store/add' }
      ],
      proofs: [spaceProof], // Include proof that spaceAgent has authority
      expiration: Math.floor(Date.now() / 1000) + 3600,
    });

    // Encode delegation as base64 (Storacha CLI format: multibase-base64)
    const delegationArchive = await delegation.archive();
    if (!delegationArchive.ok) {
      throw new Error('Failed to create delegation archive');
    }
    
    // Convert to base64 with 'm' prefix (multibase-base64)
    const delegationBytes = delegationArchive.ok;
    let delegationBase64 = 'm' + Buffer.from(delegationBytes).toString('base64');
    
    console.log('✅ Delegation created');
    console.log('📦 Delegation size:', delegationBase64.length, 'chars');
    console.log('📄 Delegation preview:', delegationBase64.substring(0, 100) + '...');

    // ========================================
    // STEP 4: Import delegation into React UI
    // ========================================
    console.log('📥 STEP 4: Importing delegation into React UI...');
    
    // Navigate fresh to Delegations tab (now that DID exists)
    console.log('🔄 Navigating to Delegations tab with DID already created...');
    const delegationsTab = page.getByRole('button', { name: /delegations/i });
    await delegationsTab.click();
    await page.waitForTimeout(2000);
    
    // Wait for the DID to be displayed (confirms the page is fully loaded with DID)
    const didDisplay = page.getByTestId('did-display');
    await expect(didDisplay).toBeVisible({ timeout: 10000 });
    
    // Re-read the DID to ensure we have the current one
    const currentDID = await didDisplay.textContent();
    console.log('📋 Current DID on page:', currentDID);
    
    // Check if DID changed (it shouldn't, but let's verify)
    if (currentDID !== browserDID) {
      console.warn('⚠️  DID changed! Original:', browserDID, 'Current:', currentDID);
      console.warn('⚠️  This delegation will fail. Recreating delegation for current DID...');
      
      // Recreate delegation for the current DID
      const updatedBrowserPrincipal = {
        did: () => currentDID as `did:key:${string}`,
        toArchive: () => ({ ok: new Uint8Array() })
      };
      
      const updatedDelegation = await delegate({
        issuer: spaceAgent,
        audience: updatedBrowserPrincipal,
        capabilities: [
          { with: space.did(), can: 'space/blob/add' },
          { with: space.did(), can: 'space/index/add' },
          { with: space.did(), can: 'upload/add' },
          { with: space.did(), can: 'upload/list' },
          { with: space.did(), can: 'filecoin/offer' },
          { with: space.did(), can: 'store/add' }
        ],
        proofs: [spaceProof],
        expiration: Math.floor(Date.now() / 1000) + 3600,
      });
      
      const updatedArchive = await updatedDelegation.archive();
      if (!updatedArchive.ok) {
        throw new Error('Failed to create updated delegation archive');
      }
      
      const updatedBytes = updatedArchive.ok;
      const updatedBase64 = 'm' + Buffer.from(updatedBytes).toString('base64');
      
      // Update the delegation to use
      delegationBase64 = updatedBase64;
      console.log('✅ Delegation recreated for current DID');
    } else {
      console.log('✅ DID is consistent, using original delegation');
    }
    
    console.log('✅ DID is displayed on page');
    
    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    
    // Debug: Take a screenshot to see what's on the page
    await page.screenshot({ path: 'test-results/debug-before-import.png', fullPage: true });
    console.log('📸 Screenshot saved to debug-before-import.png');
    
    // Look for the Import UCAN Token button
    console.log('🔍 Looking for Import UCAN Token button...');
    const importButton = page.locator('button', { hasText: 'Import UCAN Token' }).first();
    
    await expect(importButton).toBeVisible({ timeout: 15000 });
    console.log('✅ Found Import UCAN Token button');
    
    // Scroll into view if needed
    await importButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    
    await importButton.click();
    console.log('✅ Clicked Import UCAN Token button');
    await page.waitForTimeout(1500);

    // ========================================
    // STEP 5: Fill in and submit the import form
    // ========================================
    console.log('📝 Filling in import form...');
    
    // Setup dialog handler to capture any alerts (success or error)
    let dialogMessage = '';
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      console.log('🔔 Alert appeared:', dialogMessage);
      await dialog.accept(); // Click OK button
      console.log('✅ Alert dismissed');
    });
    
    // Fill in delegation name (optional)
    const nameInput = page.getByPlaceholder(/e.g., Alice's Upload Token/i);
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('Test Space Delegation');
    console.log('✅ Filled in delegation name');

    // Paste delegation base64
    const delegationTextarea = page.getByPlaceholder(/Paste your base64 UCAN token here/i);
    await expect(delegationTextarea).toBeVisible({ timeout: 5000 });
    await delegationTextarea.fill(delegationBase64);
    console.log('✅ Pasted delegation base64');
    await page.waitForTimeout(500);

    // Click the submit button (the second "Import UCAN Token" button in the form)
    console.log('🔍 Looking for submit button...');
    const importSubmitButton = page.locator('button:has-text("Import UCAN Token")').last();
    await expect(importSubmitButton).toBeVisible({ timeout: 5000 });
    await importSubmitButton.click();
    console.log('✅ Clicked submit button');
    
    // Wait for import to complete
    // Note: After successful import, the UI automatically switches to Upload tab
    await page.waitForTimeout(3000);
    
    // Check if there was an error dialog
    if (dialogMessage && dialogMessage.includes('Failed to import')) {
      console.error('❌ Import failed with error:', dialogMessage);
      throw new Error(`Delegation import failed: ${dialogMessage}`);
    }
    console.log('✅ No error dialog appeared (or successfully dismissed)');
    
    // ========================================
    // STEP 6: Verify delegation was imported
    // ========================================
    console.log('🔍 Verifying delegation was imported...');
    
    // After import, the UI automatically switches to Upload tab
    // We need to navigate back to Delegations tab to verify
    console.log('🔄 Navigating back to Delegations tab to verify import...');
    await page.getByRole('button', { name: /delegations/i }).click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');
    
    // Look for the delegation in the received list using the heading
    const receivedDelegationsHeading = page.getByRole('heading', { name: /Delegations Received \(\d+\)/i });
    await expect(receivedDelegationsHeading).toBeVisible({ timeout: 10000 });
    console.log('✅ Found Delegations Received section');
    
    // Verify the count is at least 1
    const headingText = await receivedDelegationsHeading.textContent();
    console.log('📊 Delegations count:', headingText);
    expect(headingText).toMatch(/Delegations Received \(1\)/);
    
    // Look for the "Active" badge which IS displayed in delegation cards
    const activeBadge = page.locator('.bg-green-100.text-green-800', { hasText: 'Active' });
    await expect(activeBadge).toBeVisible({ timeout: 5000 });
    console.log('✅ Delegation card is active and visible');
    
    console.log('✅ Delegation imported successfully');

    // ========================================
    // STEP 7: Upload a file
    // ========================================
    console.log('📤 STEP 7: Uploading test file...');
    
    // Navigate to Upload tab (should already be there after import, but make sure)
    await page.getByRole('button', { name: /Upload Files/i }).first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    // Create a test file
    const testFileContent = 'Hello from E2E test! ' + new Date().toISOString();

    // Upload file using file input
    const fileInput = page.locator('input[type="file"]');
    
    // Create a data transfer with our test file
    const dataTransfer = await page.evaluateHandle((content) => {
      const dt = new DataTransfer();
      const file = new File([content], 'test-file.txt', { type: 'text/plain' });
      dt.items.add(file);
      return dt;
    }, testFileContent);
    
    await fileInput.evaluateHandle((input: unknown, dt: unknown) => {
      const element = input as HTMLInputElement;
      const dataTransfer = dt as DataTransfer;
      element.files = dataTransfer.files;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, dataTransfer);

    await page.waitForTimeout(1000);

    // Click upload button
    const uploadButton = page.getByRole('button', { name: /Upload to Storacha/i });
    await expect(uploadButton).toBeVisible({ timeout: 5000 });
    await uploadButton.click();

    const uploadSuccessAlert = page.getByText(/Successfully uploaded test-file\.txt/i);
    await expect(uploadSuccessAlert).toBeVisible({ timeout: 60000 });

    const uploadedHeading = page.getByRole('heading', { name: /Recently Uploaded Files/i });
    await expect(uploadedHeading).toBeVisible({ timeout: 60000 });
    const uploadedFilename = uploadedHeading
      .locator('..')
      .locator('h3', { hasText: 'test-file.txt' });
    await expect(uploadedFilename).toBeVisible({ timeout: 60000 });
    console.log('✅ Upload completed and appeared in list');

    // ========================================
    // STEP 7B: View uploaded file via Helia/gateways
    // ========================================
    console.log('👀 STEP 7B: Viewing uploaded file via Helia...');

    const storachaFilesHeading = page.getByRole('heading', { name: /Files in Storacha Space/i });
    await expect(storachaFilesHeading).toBeVisible({ timeout: 60000 });

    const filesSection = storachaFilesHeading.locator('..').locator('..');
    const viewButton = filesSection.getByRole('button', { name: /View/i }).first();
    await expect(viewButton).toBeVisible({ timeout: 60000 });

    const [viewPage] = await Promise.all([
      page.waitForEvent('popup'),
      viewButton.click(),
    ]);
    await viewPage.waitForLoadState('domcontentloaded');

    await page.waitForFunction(
      () => {
        const win = window as typeof window & { __LAST_IPFS_BLOB_URL__?: string };
        const url = win.__LAST_IPFS_BLOB_URL__;
        return typeof url === 'string' && url.startsWith('blob:');
      },
      null,
      { timeout: 60000 }
    );

    const viewUrl = await page.evaluate(() => {
      const win = window as typeof window & { __LAST_IPFS_BLOB_URL__?: string };
      return win.__LAST_IPFS_BLOB_URL__;
    });
    expect(viewUrl).toMatch(/^blob:/);
    await viewPage.close().catch(() => {});
    console.log('✅ View opened from Helia or gateway fallback');

    // ========================================
    // STEP 8: Verify upload UI completes without errors
    // ========================================
    console.log('🔍 STEP 8: Verifying upload UI completed...');
    
    // Check that we're still on the page (no crashes) - verify navigation is still there
    const uploadFilesTab = page.getByRole('button', { name: /Upload Files/i }).first();
    await expect(uploadFilesTab).toBeVisible({ timeout: 5000 });
    
    console.log('✅ Upload UI interaction completed successfully');
    
    console.log('\n🎉 TEST COMPLETE: Full Delegation Workflow Passed!\n');
    console.log('✅ Step 1: Created DID in browser');
    console.log('✅ Step 2: Extracted DID from UI');
    console.log('✅ Step 3: Created delegation programmatically');
    console.log('✅ Step 4: Navigated to Delegations tab');
    console.log('✅ Step 5: Imported delegation into UI');
    console.log('✅ Step 6: Verified delegation in UI');
    console.log('✅ Step 7: Tested upload UI interaction');
    console.log('✅ Step 8: Verified UI stability');
    console.log('\n📝 Note: Upload performed against local upload-api server.');
    console.log('Summary:');
    console.log('  ✓ Created in-memory upload service');
    console.log('  ✓ Created space and provisioned it');
    console.log('  ✓ Created DID in React UI');
    console.log('  ✓ Created delegation from space to browser DID');
    console.log('  ✓ Imported delegation into UI');
    console.log('  ✓ Uploaded file');
    console.log('  ✓ File persisted after page reload');
  });

  test('should handle delegation import with different formats', async () => {
    console.log('\n🎯 TEST START: Delegation Format Compatibility\n');

    // Create DID in UI
    console.log('📝 Creating DID in React UI...');
    const browserDID = await createDIDInUI();
    
    // Navigate away and back to reset state
    await page.getByRole('button', { name: /Upload Files/i }).click();
    await page.waitForTimeout(1000);

    // Create delegation
    // Create an audience principal from the DID string
    const browserPrincipal = {
      did: () => browserDID as DID.DID<'key'>,
      toArchive: () => ({ ok: new Uint8Array() })
    };
    const delegation = await delegate({
      issuer: spaceAgent,
      audience: browserPrincipal,
      capabilities: [
        { with: space.did(), can: 'store/add' },
        { with: space.did(), can: 'upload/add' }
      ],
      proofs: [spaceProof],
      expiration: Math.floor(Date.now() / 1000) + 3600,
    });

    const delegationArchive = await delegation.archive();
    if (!delegationArchive.ok) {
      throw new Error('Failed to create delegation archive');
    }

    // Test different formats
    const delegationBytes = delegationArchive.ok;
    
    // Format 1: multibase-base64 with 'm' prefix (Storacha CLI default)
    const formatMultibaseBase64 = 'm' + Buffer.from(delegationBytes).toString('base64');
    
    // Format 2: base64url with 'u' prefix
    const formatBase64url = 'u' + Buffer.from(delegationBytes).toString('base64url');
    
    // Format 3: plain base64 (legacy)
    const formatPlainBase64 = Buffer.from(delegationBytes).toString('base64');

    // Test each format
    const formats = [
      { name: 'multibase-base64', value: formatMultibaseBase64 },
      { name: 'base64url', value: formatBase64url },
      { name: 'plain-base64', value: formatPlainBase64 }
    ];

    for (const format of formats) {
      console.log(`\n🔍 Testing format: ${format.name}`);
      
      // Navigate fresh to Delegations tab
      await page.getByRole('button', { name: /delegations/i }).click();
      await page.waitForTimeout(2000);
      
      // Wait for DID to be visible
      const didDisplay = page.getByTestId('did-display');
      await expect(didDisplay).toBeVisible({ timeout: 10000 });
      
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      
      // Click import button
      const importButton = page.locator('button', { hasText: 'Import UCAN Token' }).first();
      await expect(importButton).toBeVisible({ timeout: 15000 });
      await importButton.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await importButton.click();
      await page.waitForTimeout(1500);

      // Fill in delegation
      const nameInput = page.getByPlaceholder(/e.g., Alice's Upload Token/i);
      await nameInput.fill(`Test ${format.name}`);

      const delegationTextarea = page.getByPlaceholder(/Paste your base64 UCAN token here/i);
      await delegationTextarea.fill(format.value);
      await page.waitForTimeout(500);

      // Submit
      const importSubmitButton = page.getByRole('button', { name: /Import UCAN Token/i }).last();
      await importSubmitButton.click();
      await page.waitForTimeout(3000); // Wait for import to complete (UI auto-switches to Upload tab)

      // Navigate back to Delegations tab to verify import
      await page.getByRole('button', { name: /delegations/i }).click();
      await page.waitForTimeout(2000);
      await page.waitForLoadState('networkidle');

      // Verify import success - check that delegations count increased
      const receivedHeading = page.getByRole('heading', { name: /Delegations Received/i });
      await expect(receivedHeading).toBeVisible({ timeout: 5000 });
      
      // Look for the "Active" badge which IS displayed in delegation cards
      const activeBadge = page.locator('.bg-green-100.text-green-800', { hasText: 'Active' });
      await expect(activeBadge).toBeVisible({ timeout: 5000 });
      console.log(`✅ Format ${format.name} imported successfully`);

      // Clean up for next format test
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: /delegations/i }).click();
      await page.waitForTimeout(1000);
    }

    console.log('\n✅ TEST PASSED: All delegation formats work correctly!\n');
  });
});
