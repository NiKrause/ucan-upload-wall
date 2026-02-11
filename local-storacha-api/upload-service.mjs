import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromWeb = createRequire(new URL('../web/package.json', import.meta.url));
const moduleCache = new Map();
const pendingBlobAdds = new Map();

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
  const pkgRoot = path.join(repoRoot, 'web', 'node_modules', pkgName);
  const resolved = resolveExportTarget(pkgRoot, subpath);
  return resolved;
}

async function importFromWeb(specifier) {
  if (moduleCache.has(specifier)) {
    return moduleCache.get(specifier);
  }
  let resolved = null;
  if (typeof import.meta.resolve === 'function') {
    try {
      const resolvedUrl = import.meta.resolve(
        specifier,
        pathToFileURL(path.join(repoRoot, 'web', 'package.json')).href
      );
      resolved = resolvedUrl.startsWith('file://')
        ? fileURLToPath(resolvedUrl)
        : resolvedUrl;
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    try {
      resolved = requireFromWeb.resolve(specifier);
    } catch {
      resolved = resolveFromWebNodeModules(specifier);
    }
  }
  if (!resolved) {
    throw new Error(`Failed to resolve ${specifier} from web/node_modules`);
  }
  const loaded = await import(pathToFileURL(resolved).href);
  moduleCache.set(specifier, loaded);
  return loaded;
}

export async function loadUploadApiTestContext() {
  try {
    const helpers = await importFromWeb('@storacha/upload-api/test/context');
    return {
      createContext: helpers.createContext,
      cleanupContext: helpers.cleanupContext,
    };
  } catch (error) {
    try {
      const contextPath = path.join(
        repoRoot,
        'web',
        'node_modules',
        '@storacha',
        'upload-api',
        'dist',
        'test',
        'helpers',
        'context.js'
      );
      if (!fs.existsSync(contextPath)) {
        throw error;
      }
      const helpers = await import(pathToFileURL(contextPath).href);
      return {
        createContext: helpers.createContext,
        cleanupContext: helpers.cleanupContext,
      };
    } catch (fallbackError) {
      console.error('❌ Failed to load upload-api test utilities:', fallbackError);
      console.log('💡 Make sure to run: npm install --save-dev @storacha/upload-api @storacha/capabilities @ucanto/server');
      throw fallbackError;
    }
  }
}

/**
 * Refresh indexing/claims service proofs to avoid expiration errors.
 * These proofs are used by the internal mock services (assert/index, assert/assert).
 *
 * @param {object} context
 * @returns {Promise<void>}
 */
export async function refreshExternalServiceProofs(context) {
  const expiration = Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 60 * 60;
  const updateProof = async (service, delegateFn, label) => {
    if (!service?.invocationConfig) {
      return;
    }
    const { issuer, audience } = service.invocationConfig;
    if (!issuer || !audience || typeof audience.did !== 'function') {
      return;
    }
    try {
      const proof = await delegateFn({
        issuer: audience,
        with: audience.did(),
        audience: issuer,
        expiration,
      });
      service.invocationConfig.proofs = [proof];
      console.log(`✅ Refreshed ${label} proof (exp ${new Date(expiration * 1000).toISOString()})`);
    } catch (error) {
      console.warn(`⚠️ Failed to refresh ${label} proof:`, error?.message ?? error);
    }
  };

  if (context?.indexingService) {
    const AssertCaps = await importFromWeb('@storacha/capabilities/assert');
    await updateProof(
      context.indexingService,
      (options) => AssertCaps.assert.delegate(options),
      'indexing service'
    );
  }

  if (context?.claimsService) {
    const { Assert } = await importFromWeb('@web3-storage/content-claims/capability');
    await updateProof(
      context.claimsService,
      (options) => Assert.assert.delegate(options),
      'claims service'
    );
  }
}

export function noteBlobAdd(spaceDid, multihash) {
  if (!spaceDid || !multihash) {
    return;
  }
  pendingBlobAdds.set(multihash, spaceDid);
}

export function consumeBlobAddSpace(multihash) {
  if (!multihash) {
    return null;
  }
  const spaceDid = pendingBlobAdds.get(multihash) ?? null;
  pendingBlobAdds.delete(multihash);
  return spaceDid;
}

/**
 * Create an HTTP wrapper that adds permissive CORS headers and optionally
 * reports PUT payloads (storage uploads).
 *
 * @param {object} [options]
 * @param {(info: { bytes: Uint8Array, url: string, headers: import('http').IncomingHttpHeaders }) => void | Promise<void>} [options.onPutBytes]
 * @param {(info: { bytes: Uint8Array, url: string, headers: import('http').IncomingHttpHeaders }) => void | Promise<void>} [options.onCarBytes]
 * @returns {import('http')}
 */
export function createCorsHttp({ onPutBytes, onCarBytes } = {}) {
  return {
    ...http,
    createServer: (handler) =>
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
          const chunks = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', () => {
            const bytes = new Uint8Array(Buffer.concat(chunks));
            if (onPutBytes) {
              Promise.resolve(
                onPutBytes({
                  bytes,
                  url: req.url ?? '',
                  headers: req.headers ?? {},
                })
              ).catch((error) => {
                console.warn('⚠️ onPutBytes handler failed:', error?.message ?? error);
              });
            }
          });
        }

        return handler(req, res);
      }),
  };
}

async function createVarsigPrincipal(varsigModule = null) {
  const { Verifier: BaseVerifier, WebAuthnEd25519 } = await importFromWeb('@ucanto/principal');
  const { p256 } = await importFromWeb('@noble/curves/p256');
  let varsig = varsigModule;
  if (!varsig) {
    try {
      varsig = await import('iso-webauthn-varsig');
    } catch {
      try {
        const localVarsigUrl = new URL(
          '../iso-repo/packages/iso-webauthn-varsig/src/index.js',
          import.meta.url
        );
        varsig = await import(localVarsigUrl.href);
      } catch {
        console.warn('⚠️ WebAuthn varsig module not found; falling back to base verifier');
        return BaseVerifier;
      }
    }
  }
  const {
    decodeWebAuthnVarsigV1,
    reconstructSignedData,
    verifyEd25519Signature,
    verifyP256Signature,
    verifyWebAuthnAssertion,
    VARSIG_PREFIX,
    VARSIG_VERSION,
    concat,
  } = varsig;

  /**
   * Convert ASN.1 DER ECDSA signature to raw r|s for P-256 verification.
   * WebAuthn often returns DER, while WebCrypto verify expects fixed 64-byte raw.
   *
   * @param {Uint8Array} signature
   * @returns {Uint8Array}
   */
  const normalizeP256Signature = (signature) => {
    if (!(signature instanceof Uint8Array)) {
      return signature;
    }
    // Already raw P-256 signature (r|s)
    if (signature.length === 64) {
      return signature;
    }
    // Quick DER shape check: SEQUENCE (0x30)
    if (signature.length < 8 || signature[0] !== 0x30) {
      return signature;
    }

    let offset = 1;
    let seqLen = signature[offset++];
    if (seqLen & 0x80) {
      const lenBytes = seqLen & 0x7f;
      if (lenBytes < 1 || lenBytes > 2 || offset + lenBytes > signature.length) {
        return signature;
      }
      seqLen = 0;
      for (let i = 0; i < lenBytes; i += 1) {
        seqLen = (seqLen << 8) | signature[offset++];
      }
    }

    if (signature[offset++] !== 0x02) return signature;
    const rLen = signature[offset++];
    if (offset + rLen > signature.length) return signature;
    let r = signature.slice(offset, offset + rLen);
    offset += rLen;

    if (signature[offset++] !== 0x02) return signature;
    const sLen = signature[offset++];
    if (offset + sLen > signature.length) return signature;
    let s = signature.slice(offset, offset + sLen);

    // Remove ASN.1 positive-sign leading zeros
    while (r.length > 32 && r[0] === 0x00) r = r.slice(1);
    while (s.length > 32 && s[0] === 0x00) s = s.slice(1);
    if (r.length > 32 || s.length > 32) return signature;

    const raw = new Uint8Array(64);
    raw.set(r, 32 - r.length);
    raw.set(s, 64 - s.length);
    return raw;
  };

  const wrapVerifier = (did) => {
    const edVerifier = BaseVerifier.parse(did);
    const webauthnVerifier = WebAuthnEd25519?.Verifier?.create
      ? WebAuthnEd25519.Verifier.create(edVerifier.publicKey, did)
      : null;
    const originRaw = process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:4173';
    const fallbackRaw = process.env.WEBAUTHN_ORIGIN_FALLBACKS ?? '';
    const fallbackList = fallbackRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const expectedOrigins = [originRaw, ...fallbackList];
    const normalizedOrigins = new Set(expectedOrigins);
    const originHost = new URL(originRaw).hostname;
    if (originHost === 'localhost') {
      normalizedOrigins.add(originRaw.replace('localhost', '127.0.0.1'));
    } else if (originHost === '127.0.0.1') {
      normalizedOrigins.add(originRaw.replace('127.0.0.1', 'localhost'));
    }
    const originCandidates = Array.from(normalizedOrigins);
    const toP256RawPublicKey = (publicKey) => {
      if (!publicKey) {
        return publicKey;
      }
      if (publicKey.byteLength === 33) {
        try {
          return p256.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
        } catch {
          return publicKey;
        }
      }
      return publicKey;
    };

    return {
      code: edVerifier.code,
      signatureCode: edVerifier.signatureCode,
      signatureAlgorithm: edVerifier.signatureAlgorithm,
      did: () => did,
      toDIDKey: () => edVerifier.toDIDKey(),
      verify: async (payload, signature) => {
        const raw = signature?.raw ?? signature;
        if (raw?.byteLength && raw.byteLength >= 2 && raw[0] === VARSIG_PREFIX && raw[1] === VARSIG_VERSION) {
          try {
            const decoded = decodeWebAuthnVarsigV1(raw);
            const domain = new TextEncoder().encode('ucan-webauthn-v1:');
            const challengeInput = concat([domain, payload]);
            const challengeHash = await crypto.subtle.digest('SHA-256', challengeInput);
            let verification = null;
            for (const expectedOrigin of originCandidates) {
              const expectedRpId = new URL(expectedOrigin).hostname;
              // Try each origin to avoid localhost/127.0.0.1 mismatches in local dev.
              // eslint-disable-next-line no-await-in-loop
              verification = await verifyWebAuthnAssertion(decoded, {
                expectedOrigin,
                expectedRpId,
                expectedChallenge: new Uint8Array(challengeHash),
                requireUserVerification: false,
              });
              if (verification.valid) {
                break;
              }
            }
            if (!verification?.valid) {
              return false;
            }
            const signedData = await reconstructSignedData(decoded);
            if (decoded.algorithm === 'P-256') {
              const p256PublicKey = toP256RawPublicKey(edVerifier.publicKey);
              const normalizedSignature = normalizeP256Signature(decoded.signature);
              return verifyP256Signature(signedData, normalizedSignature, p256PublicKey);
            }
            return verifyEd25519Signature(signedData, decoded.signature, edVerifier.publicKey);
          } catch (error) {
            console.error('[ucanto-varsig] v1 verification error:', error);
            return false;
          }
        }
        if (raw?.byteLength && raw.byteLength !== 64) {
          if (!webauthnVerifier) {
            return false;
          }
          return webauthnVerifier.verify(payload, signature);
        }
        return edVerifier.verify(payload, signature);
      },
      withDID: (nextId) => wrapVerifier(nextId),
    };
  };

  return { parse: wrapVerifier };
}

/**
 * Start the in-memory upload-api server.
 *
 * Upload flow (high level):
 * - space/blob/add stores shard blobs.
 * - space/index/add registers the DAG index.
 * - upload/add registers the upload entry.
 *
 * Listing behavior:
 * - upload/list returns entries only after upload/add completes.
 * - space/blob/list returns blobs after space/blob/add completes.
 *
 * This server decodes list responses and logs a small summary so you can
 * confirm that uploads are discoverable via list calls.
 *
 * @param {object} context
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {boolean} [options.autoProvision]
 * @param {unknown} [options.varsigModule]
 * @param {(invocation: unknown) => Promise<void>} [options.onInvocation]
 * @param {(payload: { can: string; results: unknown[] }) => Promise<void>} [options.onListResults]
 * @param {(info: { bytes: Uint8Array, url: string, headers: import('http').IncomingHttpHeaders }) => void | Promise<void>} [options.onCarBytes]
 * @returns {Promise<{ server: import('http').Server, url: string }>}
 */
export async function startUploadApiServer(context, options = {}) {
  const { createServer, handle } = await importFromWeb('@storacha/upload-api');
  const { CAR } = await importFromWeb('@ucanto/transport');
  const CARTransport = await importFromWeb('@ucanto/transport/car');
  const { Message, Receipt } = await importFromWeb('@ucanto/core');
  const Digest = await importFromWeb('multiformats/hashes/digest');
  const { base58btc } = await importFromWeb('multiformats/bases/base58');
  const principal = await createVarsigPrincipal(options.varsigModule);

  const { onInvocation, onListResults, port, autoProvision, onCarBytes } = options;
  const revocations = new Map();
  const agent = createServer({
    ...context,
    codec: CAR.inbound,
    principal,
  });

  /**
   * upload/list and space/blob/list responses:
   * - upload/list returns entries after upload/add completes.
   * - space/blob/list returns stored blob entries after space/blob/add finishes.
   * This handler decodes responses and logs list results for debugging.
   */
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

    if (req.method === 'GET' && req.url?.startsWith('/revocations/')) {
      const delegationCid = req.url.slice('/revocations/'.length);
      if (!delegationCid) {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }

      const record = revocations.get(delegationCid);
      if (!record) {
        res.writeHead(404, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ revoked: false, status: 'not_found' }));
        return;
      }

      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          revoked: true,
          status: 'revoked',
          revokedAt: record.revokedAt,
          revokedBy: record.revokedBy,
        })
      );
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

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const contentType = req.headers?.['content-type'] ?? '';
    const isCarRequest =
      typeof contentType === 'string' &&
      (contentType.includes('application/car') || contentType.includes('application/vnd.ipld.car'));
    if (onCarBytes && isCarRequest) {
      Promise.resolve(
        onCarBytes({
          bytes: new Uint8Array(body),
          url: req.url ?? '',
          headers: req.headers ?? {},
        })
      ).catch((error) => {
        console.warn('⚠️ onCarBytes handler failed:', error?.message ?? error);
      });
    }

    const listInvocations = [];
    const revokeInvocations = [];
    try {
      const message = await CARTransport.request.decode({ headers: req.headers, body });
      const blobAdds = [];
      const formatProof = (proof) => {
        const cid = proof?.cid?.toString?.() ?? null;
        const signature = proof?.signature?.raw ?? proof?.signature;
        const length = signature?.byteLength ?? signature?.length ?? null;
        const prefix =
          signature?.byteLength || signature?.length
            ? Array.from(signature.slice(0, 2))
            : null;
        return {
          cid,
          signatureLength: length,
          signaturePrefix: prefix,
        };
      };

      for (const invocation of message.invocations) {
        const proofLinks = (invocation.proofs ?? []).map((proof) =>
          proof?.cid?.toString?.() ?? String(proof)
        );
        const proofDetails = (invocation.proofs ?? []).map(formatProof);
        console.log('🧪 Invocation received:', {
          can: invocation.capabilities?.map((cap) => cap.can).join(', '),
          proofs: proofLinks
        });
        if (proofDetails.length > 0) {
          console.log('🧾 Invocation proof details:', proofDetails);
        }
        if (onInvocation) {
          await onInvocation(invocation);
        }
        for (const capability of invocation.capabilities ?? []) {
          if (capability?.can === 'ucan/revoke') {
            revokeInvocations.push({ invocation, capability });
          }
          if (capability?.can === 'upload/list' || capability?.can === 'space/blob/list') {
            listInvocations.push(capability.can);
          }
        }
        for (const capability of invocation.capabilities ?? []) {
          if (capability?.can !== 'space/blob/add') {
            continue;
          }
          const blob = capability?.nb?.blob;
          if (!blob?.digest) {
            continue;
          }
          blobAdds.push({
            space: capability?.with,
            digest: blob.digest,
            size: blob.size,
          });
        }
        if (autoProvision && context?.provisionsStorage?.hasStorageProvider && context?.provisionsStorage?.put) {
          for (const capability of invocation.capabilities ?? []) {
            let consumer = capability?.with;
            if (consumer && typeof consumer !== 'string') {
              if (typeof consumer.did === 'function') {
                consumer = consumer.did();
              } else if (typeof consumer.toString === 'function') {
                consumer = consumer.toString();
              }
            }
            if (typeof consumer !== 'string' || !consumer.startsWith('did:')) {
              continue;
            }
            const hasProvider = await context.provisionsStorage.hasStorageProvider(consumer);
            if (hasProvider?.ok) {
              continue;
            }
            const provisionResult = await context.provisionsStorage.put({
              cause: invocation,
              consumer,
              customer: 'did:mailto:local@storacha.test',
              provider: context.id.did(),
            });
            if (provisionResult?.ok) {
              console.log(`✅ Auto-provisioned storage for ${consumer}`);
            } else if (provisionResult?.error) {
              console.warn(`⚠️ Auto-provision failed for ${consumer}: ${provisionResult.error.message ?? provisionResult.error}`);
            }
          }
        }
      }

      for (const blobAdd of blobAdds) {
        if (typeof blobAdd.space !== 'string') {
          continue;
        }
        try {
          const digest = Digest.decode(blobAdd.digest);
          const multihash = base58btc.encode(digest.bytes);
          noteBlobAdd(blobAdd.space, multihash);
          const registryRes = await context.registry?.find?.(blobAdd.space, digest);
          const hasBlob =
            context.blobsStorage?.has ? await context.blobsStorage.has(digest) : null;
          const registryStatus = registryRes?.ok ? 'registered' : 'missing';
          const storageStatus =
            hasBlob?.ok === true ? 'stored' : hasBlob?.ok === false ? 'missing' : 'unknown';
          console.log(
            `📦 Blob add check: space=${blobAdd.space} multihash=${multihash} size=${blobAdd.size ?? 'unknown'} registry=${registryStatus} storage=${storageStatus}`
          );
        } catch (error) {
          console.warn('⚠️ Failed to verify blob add:', error?.message ?? error);
        }
      }

      if (revokeInvocations.length > 0 && revokeInvocations.length === message.invocations.length) {
        const receipts = [];
        for (const { invocation, capability } of revokeInvocations) {
          const revokeCid = capability?.nb?.ucan?.toString?.() ?? null;
          if (revokeCid) {
            revocations.set(revokeCid, {
              revokedAt: new Date().toISOString(),
              revokedBy: invocation.issuer?.did?.() ?? null,
            });
          }
          const receipt = await Receipt.issue({
            issuer: context.id,
            ran: invocation,
            result: { ok: {} },
          });
          receipts.push(receipt);
        }

        const responseMessage = await Message.build({ receipts });
        const responseBody = CARTransport.response.encode(responseMessage).body;
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Content-Type': 'application/car',
        });
        res.end(responseBody);
        return;
      }

    } catch (error) {
      console.warn('🧪 Failed to decode UCAN request for capture:', error?.message ?? error);
    }

    const response = await handle(agent, { headers: req.headers, body });
    if (listInvocations.length > 0 && response?.body) {
      try {
        const responseMessage = await CARTransport.response.decode({
          headers: response.headers ?? {},
          body: response.body,
        });
        for (const invocation of responseMessage.invocations) {
          const capabilities = invocation.capabilities ?? [];
          const hasList = capabilities.some((cap) =>
            cap?.can === 'upload/list' || cap?.can === 'space/blob/list'
          );
          if (!hasList) {
            continue;
          }
          const receipt = responseMessage.get(invocation.link(), null);
          const outcome = receipt?.out;
          if (outcome?.ok) {
            const ok = outcome.ok;
            if (Array.isArray(ok?.results)) {
              const sample = ok.results.slice(0, 3).map((entry) => {
                const blobDigest = entry?.blob?.digest?.bytes
                  ? base58btc.encode(entry.blob.digest.bytes)
                  : null;
                const root = entry?.root?.toString?.() ?? entry?.root ?? null;
                return {
                  blob: blobDigest ?? undefined,
                  root: root ?? undefined,
                };
              });
              if (onListResults) {
                const listCap = capabilities.find((cap) =>
                  cap?.can === 'upload/list' || cap?.can === 'space/blob/list'
                );
                await onListResults({
                  can: listCap?.can ?? 'unknown',
                  results: ok.results,
                });
              }
              console.log('📋 List response:', {
                can: capabilities.map((cap) => cap.can).join(', '),
                size: ok.size ?? ok.results.length,
                sample,
              });
            } else {
              console.log('📋 List response:', {
                can: capabilities.map((cap) => cap.can).join(', '),
                ok,
              });
            }
          } else if (outcome?.error) {
            console.warn('⚠️ List response error:', outcome.error?.message ?? outcome.error);
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to decode list response:', error?.message ?? error);
      }
    }
    if (response?.body) {
      try {
        const responseMessage = await CARTransport.response.decode({
          headers: response.headers ?? {},
          body: response.body,
        });
        for (const invocation of responseMessage.invocations) {
          const capabilities = invocation.capabilities ?? [];
          const hasIndexAdd = capabilities.some((cap) => cap?.can === 'space/index/add');
          if (!hasIndexAdd) {
            continue;
          }
          const receipt = responseMessage.get(invocation.link(), null);
          const outcome = receipt?.out;
          if (outcome?.error) {
            console.warn('⚠️ space/index/add receipt error:', outcome.error);
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to decode receipt response:', error?.message ?? error);
      }
    }
    console.log(`✅ upload-api response ${response.status || 200} ${req.method} ${req.url}`);
    res.writeHead(response.status || 200, {
      ...response.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(response.body);
  });

  const listenPort = Number.isFinite(port) ? Number(port) : 0;
  await new Promise((resolve) => {
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind upload-api HTTP server');
  }

  return { server, url: `http://127.0.0.1:${address.port}` };
}
