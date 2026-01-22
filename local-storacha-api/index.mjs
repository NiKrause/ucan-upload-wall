import { consumeBlobAddSpace, createCorsHttp, loadUploadApiTestContext, refreshExternalServiceProofs, startUploadApiServer } from './upload-service.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function parsePackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name, ...rest] = specifier.split('/');
    return {
      pkgName: `${scope}/${name}`,
      subpath: rest.length ? `./${rest.join('/')}` : '.',
    };
  }
  const [name, ...rest] = specifier.split('/');
  return {
    pkgName: name,
    subpath: rest.length ? `./${rest.join('/')}` : '.',
  };
}

function resolveExportTarget(pkgRoot, subpath) {
  const pkgPath = path.join(pkgRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const exportsField = pkg.exports;
  if (!exportsField) {
    return pkg.main ? path.join(pkgRoot, pkg.main) : null;
  }
  let target = null;
  if (typeof exportsField === 'string') {
    target = subpath === '.' ? exportsField : null;
  } else if (exportsField[subpath]) {
    target = exportsField[subpath];
  } else if (subpath === '.' && exportsField['.']) {
    target = exportsField['.'];
  }
  if (!target) {
    return null;
  }
  if (typeof target === 'string') {
    return path.join(pkgRoot, target);
  }
  const entry = target.import ?? target.default ?? target.require ?? null;
  return entry ? path.join(pkgRoot, entry) : null;
}

function resolveFromWebNodeModules(specifier) {
  const { pkgName, subpath } = parsePackageSpecifier(specifier);
  const pkgRoot = path.join(
    path.dirname(fileURLToPath(new URL('../web/package.json', import.meta.url))),
    'node_modules',
    pkgName
  );
  return resolveExportTarget(pkgRoot, subpath);
}

async function importFromWeb(specifier) {
  if (typeof import.meta.resolve === 'function') {
    try {
      const resolvedUrl = import.meta.resolve(
        specifier,
        new URL('../web/package.json', import.meta.url).href
      );
      return import(resolvedUrl);
    } catch {
      // Fall through to manual export resolution.
    }
  }
  const resolved = resolveFromWebNodeModules(specifier);
  if (!resolved) {
    throw new Error(`Failed to resolve ${specifier} from web/node_modules`);
  }
  return import(pathToFileURL(resolved).href);
}

async function startHeliaNode() {
  const { createHelia } = await importFromWeb('helia');
  const { createLibp2p } = await importFromWeb('libp2p');
  const { webSockets } = await importFromWeb('@libp2p/websockets');
  const { noise } = await importFromWeb('@chainsafe/libp2p-noise');
  const { yamux } = await importFromWeb('@chainsafe/libp2p-yamux');
  const { identify } = await importFromWeb('@libp2p/identify');
  const { ping } = await importFromWeb('@libp2p/ping');
  const { kadDHT } = await importFromWeb('@libp2p/kad-dht');

  const libp2p = await createLibp2p({
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    addresses: {
      listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    },
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({ clientMode: true }),
    },
  });

  libp2p.addEventListener('peer:connect', (event) => {
    const peerId = event.detail?.toString?.() ?? 'unknown';
    console.log(`🟣 Helia peer connected: ${peerId}`);
  });
  libp2p.addEventListener('peer:disconnect', (event) => {
    const peerId = event.detail?.toString?.() ?? 'unknown';
    console.log(`🟣 Helia peer disconnected: ${peerId}`);
  });

  const helia = await createHelia({ libp2p });
  const peerId = libp2p.peerId.toString();
  const addrs = libp2p.getMultiaddrs().map((addr) => addr.toString());

  console.log('🟣 Helia local node ready:', { peerId, addrs });
  console.log(`🟣 Use VITE_HELIA_PEER_ID=${peerId}`);
  console.log(`🟣 Use VITE_HELIA_ADDRS=${addrs.join(',')}`);

  return { helia, peerId, addrs };
}

let varsigModule = null;
if (!process.env.WEBAUTHN_ORIGIN) {
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
}
try {
  varsigModule = await import(
    new URL('../web/src/lib/webauthn-varsig/index.ts', import.meta.url)
  );
} catch (error) {
  console.warn('⚠️ WebAuthn varsig module not loaded:', error?.message ?? error);
}

const { createContext, cleanupContext } = await loadUploadApiTestContext();

console.log('📦 Creating in-memory upload service...');
const heliaInfo = await startHeliaNode();

const uploadServiceContext = await createContext({
  requirePaymentPlan: false,
  http: createCorsHttp({
    onPutBytes: async ({ bytes, url }) => {
      const pathname = url.split('?')[0] || '';
      const filename = pathname.split('/').filter(Boolean).pop() || 'unknown';
      console.log(`📥 Storage PUT received: ${filename} (${bytes.length} bytes)`);
      try {
        const { base58btc } = await importFromWeb('multiformats/bases/base58');
        const Digest = await importFromWeb('multiformats/hashes/digest');
        const { CID } = await importFromWeb('multiformats/cid');
        const { CAR } = await importFromWeb('@ucanto/transport');
        const multihash = filename.replace(/\.blob$/, '');
        const spaceDid = consumeBlobAddSpace(multihash);
        if (!spaceDid) {
          console.log(`ℹ️ Post-PUT check skipped: no space mapping for ${multihash}`);
          return;
        }
        const digest = Digest.decode(base58btc.decode(multihash));
        const cid = CID.createV1(CAR.codec.code, digest);
        await heliaInfo.helia.blockstore.put(cid, bytes);
        console.log(`🟣 Helia stored block ${cid.toString()}`);
        const registryRes = await uploadServiceContext.registry?.find?.(spaceDid, digest);
        const hasBlob = uploadServiceContext.blobsStorage?.has
          ? await uploadServiceContext.blobsStorage.has(digest)
          : null;
        const registryStatus = registryRes?.ok ? 'registered' : 'missing';
        const storageStatus =
          hasBlob?.ok === true ? 'stored' : hasBlob?.ok === false ? 'missing' : 'unknown';
        console.log(
          `✅ Post-PUT check: space=${spaceDid} multihash=${multihash} registry=${registryStatus} storage=${storageStatus}`
        );
      } catch (error) {
        console.warn('⚠️ Post-PUT check failed:', error?.message ?? error);
      }
    },
  }),
});
console.log('✅ Upload service created:', uploadServiceContext.id.did());
await refreshExternalServiceProofs(uploadServiceContext);

const port = Number.parseInt(process.env.STORACHA_LOCAL_PORT ?? '8787', 10);
console.log('🌐 Starting upload-api HTTP server...');
const serverInfo = await startUploadApiServer(uploadServiceContext, {
  varsigModule,
  port,
  autoProvision: true,
});
console.log('✅ upload-api server ready:', serverInfo.url);
console.log('🔖 Service DID:', uploadServiceContext.id.did());
console.log('🔗 Service URL:', serverInfo.url);

const shutdown = async (signal) => {
  console.log(`🧹 Shutting down (${signal})...`);
  await heliaInfo.helia.stop();
  await new Promise((resolve) => serverInfo.server.close(() => resolve()));
  await cleanupContext(uploadServiceContext);
  console.log('✅ Upload service cleaned up');
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
