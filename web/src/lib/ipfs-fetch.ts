import type { Libp2p } from 'libp2p';
import type { CID } from 'multiformats/cid';

const IPFS_GATEWAYS = [
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
  'https://storacha.link/ipfs/',
] as const;

const IPFS_BOOTSTRAP = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp5i9cM2m2E1r4NkHeF7NhU9gBbz3K',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ2wBb1jzYp5VCxQGtEex9kK',
];

type HeliaBootstrap = { peerId: string; addrs: string[] };
type GlobalHeliaOverrides = typeof globalThis & {
  __HELIA_BOOTSTRAP__?: HeliaBootstrap;
  __LAST_IPFS_BLOB_URL__?: string;
  __HELIA_READY__?: boolean;
  __HELIA_READY_PEER__?: string;
  __HELIA_READY_ERROR__?: string;
};

type Libp2pConnectionLike = {
  remotePeer?: { toString?: () => string };
};

type Libp2pLike = Pick<Libp2p, 'dial' | 'getConnections' | 'peerStore'>;

type HeliaClient = {
  libp2p: Libp2pLike;
};

type UnixFsLike = {
  cat: (cid: CID) => AsyncIterable<Uint8Array>;
};

let heliaPromise: Promise<{ helia: HeliaClient; fs: UnixFsLike }> | null = null;
const HELIA_DIAL_TIMEOUT_MS = 10000;

function logHeliaConnections(libp2p: Libp2pLike | undefined, context: string): void {
  const connections: Libp2pConnectionLike[] = libp2p?.getConnections?.() ?? [];
  const peers = new Set(
    connections.map((connection) => connection?.remotePeer?.toString?.() ?? 'unknown')
  );
  console.log(`🟣 Helia ${context}: ${connections.length} connections (${peers.size} peers)`);
}

async function dialWithTimeout(libp2p: Libp2pLike, peerId: string): Promise<void> {
  const { peerIdFromString } = await import('@libp2p/peer-id');
  await Promise.race([
    libp2p.dial(peerIdFromString(peerId)),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Helia dial timed out after ${HELIA_DIAL_TIMEOUT_MS}ms`)),
        HELIA_DIAL_TIMEOUT_MS
      )
    ),
  ]);
}

async function getHeliaClient(): Promise<{ helia: HeliaClient; fs: UnixFsLike }> {
  if (!heliaPromise) {
    heliaPromise = (async () => {
      const { createHelia } = await import('helia');
      const { bitswap } = await import('@helia/block-brokers');
      const { libp2pRouting } = await import('@helia/routers');
      const { unixfs } = await import('@helia/unixfs');
      const { createLibp2p } = await import('libp2p');
      const { bootstrap } = await import('@libp2p/bootstrap');
      const { webSockets } = await import('@libp2p/websockets');
      const { noise } = await import('@chainsafe/libp2p-noise');
      const { yamux } = await import('@chainsafe/libp2p-yamux');
      const { identify } = await import('@libp2p/identify');
      const { ping } = await import('@libp2p/ping');
      const { kadDHT } = await import('@libp2p/kad-dht');
      const heliaBootstrap = (globalThis as GlobalHeliaOverrides).__HELIA_BOOTSTRAP__;
      const libp2p = await createLibp2p({
        transports: [webSockets()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        peerDiscovery: [bootstrap({ list: IPFS_BOOTSTRAP })],
        addresses: {
          listen: [],
        },
        services: {
          identify: identify(),
          ping: ping(),
          dht: kadDHT({ clientMode: true }),
        },
      });
      const helia = await createHelia({
        libp2p,
        // Prefer local bitswap only; avoid trustless gateway fallbacks.
        blockBrokers: [bitswap()],
        routers: [libp2pRouting(libp2p)],
      });
      const fs = unixfs(helia);
      if (!heliaBootstrap?.peerId || heliaBootstrap.addrs.length === 0) {
        console.log('🟣 Helia starting without local bootstrap (public DHT only)');
        (globalThis as GlobalHeliaOverrides).__HELIA_READY__ = false;
        (globalThis as GlobalHeliaOverrides).__HELIA_READY_PEER__ = undefined;
        (globalThis as GlobalHeliaOverrides).__HELIA_READY_ERROR__ = undefined;
      } else {
        try {
          const { multiaddr } = await import('@multiformats/multiaddr');
          const { peerIdFromString } = await import('@libp2p/peer-id');
          const peerId = peerIdFromString(heliaBootstrap.peerId);
          const addrs = heliaBootstrap.addrs.map((addr) => multiaddr(addr));
          await libp2p.peerStore.patch(peerId, { multiaddrs: addrs });
          await dialWithTimeout(libp2p, heliaBootstrap.peerId);
          (globalThis as GlobalHeliaOverrides).__HELIA_READY__ = true;
          (globalThis as GlobalHeliaOverrides).__HELIA_READY_PEER__ = heliaBootstrap.peerId;
          (globalThis as GlobalHeliaOverrides).__HELIA_READY_ERROR__ = undefined;
          logHeliaConnections(libp2p, 'dialed local peer');
          if (libp2p.services?.ping) {
            try {
              const latency = await libp2p.services.ping.ping(peerId);
              console.log(`🟣 Helia ping local peer: ${latency}ms`);
            } catch (error) {
              console.warn('🟣 Helia ping failed:', (error as Error).message);
            }
          }
          console.log(`🟣 Helia node started in browser (dialed ${heliaBootstrap.peerId})`);
        } catch (error) {
          const message = `Helia local peer unavailable. Details: ${(error as Error).message}`;
          (globalThis as GlobalHeliaOverrides).__HELIA_READY__ = false;
          (globalThis as GlobalHeliaOverrides).__HELIA_READY_ERROR__ = message;
          console.warn('🟣 Helia local peer unavailable:', message);
        }
      }
      return { helia, fs };
    })();
  }
  return heliaPromise!;
}

export function warmupHeliaClient(): void {
  if (heliaPromise) {
    return;
  }
  console.log('🟣 Helia warmup starting...');
  getHeliaClient().catch((error) => {
    console.warn('🟣 Helia warmup failed:', error);
  });
}

export async function pingHeliaLocalPeer(): Promise<void> {
  const heliaBootstrap = (globalThis as GlobalHeliaOverrides).__HELIA_BOOTSTRAP__;
  if (!heliaBootstrap?.peerId) {
    return;
  }
  const { helia } = await getHeliaClient();
  const { peerIdFromString } = await import('@libp2p/peer-id');
  const peerId = peerIdFromString(heliaBootstrap.peerId);
  if (helia.libp2p.services?.ping) {
    const latency = await helia.libp2p.services.ping.ping(peerId);
    console.log(`🟣 Helia ping local peer (pre-view): ${latency}ms`);
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function detectImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
  }
  return undefined;
}

async function fetchFromHelia(cid: string): Promise<Uint8Array> {
  const { fs } = await getHeliaClient();
  const { CID } = await import('multiformats/cid');
  console.log(`🟣 Helia fs.cat started for ${cid}`);
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of fs.cat(CID.parse(cid))) {
      chunks.push(chunk);
    }
    const bytes = concatBytes(chunks);
    console.log(`🟣 Helia fs.cat completed for ${cid} (${bytes.length} bytes)`);
    return bytes;
  } catch (error) {
    console.warn(`🟣 Helia fs.cat failed for ${cid}:`, error);
    throw error;
  }
}

async function fetchFromGateways(
  cid: string
): Promise<{ bytes: Uint8Array; contentType?: string; gateway: string }> {
  let lastError: Error | null = null;
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const response = await fetch(`${gateway}${cid}`);
      if (!response.ok) {
        throw new Error(`Gateway ${gateway} responded ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        contentType: response.headers.get('content-type') ?? undefined,
        gateway,
      };
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError ?? new Error('All gateways failed');
}

export async function loadIpfsBlobUrl(
  cid: string,
  { expectImage }: { expectImage?: boolean } = {}
): Promise<{ url: string; source: 'helia' | 'gateway'; gateway?: string }> {
  try {
    const bytes = await fetchFromHelia(cid);
    const type = expectImage ? detectImageMime(bytes) : undefined;
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type }));
    (globalThis as GlobalHeliaOverrides).__LAST_IPFS_BLOB_URL__ = url;
    console.log(`🟣 Helia blob URL created for ${cid}`);
    return { url, source: 'helia' };
  } catch (error) {
    console.warn('Helia fetch failed, falling back to gateways:', error);
  }

  const { bytes, contentType, gateway } = await fetchFromGateways(cid);
  const type = expectImage ? detectImageMime(bytes) ?? contentType : contentType;
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type }));
  (globalThis as GlobalHeliaOverrides).__LAST_IPFS_BLOB_URL__ = url;
  return { url, source: 'gateway', gateway };
}

/**
 * Load IPFS blob from gateway only
 */
export async function loadIpfsBlobFromGateway(
  cid: string,
): Promise<{ data: Uint8Array; source: 'gateway'; gateway: string }> {
  const { bytes, gateway } = await fetchFromGateways(cid);
  return { data: bytes, source: 'gateway', gateway };
}

/**
 * Load IPFS blob from Helia only
 */
export async function loadIpfsBlobFromHelia(
  cid: string,
): Promise<{ data: Uint8Array; source: 'helia' }> {
  console.log(`🟣 Loading IPFS blob from Helia for ${cid}`);
  const bytes = await fetchFromHelia(cid);
  console.log(`🟣 Helia blob data retrieved for ${cid}`);
  return { data: bytes, source: 'helia' };
}

/**
 * Load IPFS blob - tries gateways first, falls back to Helia
 */
export async function loadIpfsBlob(
  cid: string,
): Promise<{ data: Uint8Array; source: 'helia' | 'gateway'; gateway?: string }> {
  const heliaBootstrap = (globalThis as GlobalHeliaOverrides).__HELIA_BOOTSTRAP__;
  const preferHelia = Boolean(heliaBootstrap?.peerId && heliaBootstrap.addrs?.length);

  // In local/test mode we have an explicit in-process Helia peer and content may
  // exist only there (not on public gateways). Prefer Helia first to avoid long
  // gateway hangs before falling back.
  if (preferHelia) {
    try {
      return await loadIpfsBlobFromHelia(cid);
    } catch (error) {
      console.warn('Helia fetch failed, falling back to gateways:', error);
    }
    return await loadIpfsBlobFromGateway(cid);
  }

  try {
    return await loadIpfsBlobFromGateway(cid);
  } catch (error) {
    console.warn('Gateway fetch failed, falling back to Helia:', error);
  }
  try {
    return await loadIpfsBlobFromHelia(cid);
  } catch (error) {
    console.warn('Helia fetch failed:', error);
    throw error;
  }
}

export function getGatewayUrl(cid: string): string {
  return `${IPFS_GATEWAYS[0]}${cid}`;
}
