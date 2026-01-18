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

let heliaPromise: Promise<{ helia: unknown; fs: any }> | null = null;
const HELIA_DIAL_TIMEOUT_MS = 10000;

function logHeliaConnections(libp2p: any, context: string): void {
  const connections = libp2p?.getConnections?.() ?? [];
  const peers = new Set(
    connections.map((connection: any) => connection?.remotePeer?.toString?.() ?? 'unknown')
  );
  console.log(`🟣 Helia ${context}: ${connections.length} connections (${peers.size} peers)`);
}

async function dialWithTimeout(libp2p: any, peerId: string): Promise<void> {
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

async function getHeliaClient(): Promise<{ helia: unknown; fs: any }> {
  if (!heliaPromise) {
    heliaPromise = (async () => {
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
      const heliaBootstrap = (globalThis as any).__HELIA_BOOTSTRAP__ as
        | { peerId: string; addrs: string[] }
        | undefined;
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
      const helia = await createHelia({ libp2p });
      const fs = unixfs(helia);
      if (!heliaBootstrap?.peerId || heliaBootstrap.addrs.length === 0) {
        throw new Error('No Helia bootstrap address provided. Start the local server Helia.');
      }
      try {
        const { multiaddr } = await import('@multiformats/multiaddr');
        const { peerIdFromString } = await import('@libp2p/peer-id');
        const peerId = peerIdFromString(heliaBootstrap.peerId);
        const addrs = heliaBootstrap.addrs.map((addr) => multiaddr(addr));
        await libp2p.peerStore.patch(peerId, { multiaddrs: addrs });
        await dialWithTimeout(libp2p, heliaBootstrap.peerId);
        logHeliaConnections(libp2p, 'dialed local peer');
      } catch (error) {
        throw new Error(
          `Helia local peer unavailable. Ensure the local server Helia is running. Details: ${
            (error as Error).message
          }`
        );
      }
      console.log(`🟣 Helia node started in browser (dialed ${heliaBootstrap.peerId})`);
      return { helia, fs };
    })();
  }
  return heliaPromise;
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
  const { helia, fs } = await getHeliaClient();
  const { CID } = await import('multiformats/cid');
  console.log(`🟣 Helia fs.cat started for ${cid}`);
  logHeliaConnections((helia as any).libp2p, `before fs.cat ${cid}`);
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of fs.cat(CID.parse(cid))) {
      chunks.push(chunk);
    }
    const bytes = concatBytes(chunks);
    console.log(`🟣 Helia fs.cat completed for ${cid} (${bytes.length} bytes)`);
    logHeliaConnections((helia as any).libp2p, `after fs.cat ${cid}`);
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
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    (globalThis as any).__LAST_IPFS_BLOB_URL__ = url;
    console.log(`🟣 Helia blob URL created for ${cid}`);
    return { url, source: 'helia' };
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    if (message.includes('Helia local peer unavailable') || message.includes('No Helia bootstrap')) {
      throw error;
    }
    console.warn('Helia fetch failed, falling back to gateways:', error);
  }

  const { bytes, contentType, gateway } = await fetchFromGateways(cid);
  const type = expectImage ? detectImageMime(bytes) ?? contentType : contentType;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  return { url, source: 'gateway', gateway };
}

export function getGatewayUrl(cid: string): string {
  return `${IPFS_GATEWAYS[0]}${cid}`;
}
