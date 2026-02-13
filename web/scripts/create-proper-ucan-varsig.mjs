#!/usr/bin/env node

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Client from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import * as Ed25519 from '@storacha/client/principal/ed25519';
import * as Proof from '@storacha/client/proof';
import { Verifier } from '@ucanto/principal';

const DEFAULT_TARGET_ED25519 = 'did:key:z6MkuYkLDa6rXQg7BrepYS1DnEZSUK45qvtEVaTSkxsmyvFF';
const DEFAULT_TARGET_P256 = 'did:key:zDnaeuYtq2wZ3bXvDLHqyo9bcUY9AtjNN5gNdDQfv9FFCeX9Q';

function getEnv(name, fallback) {
  return process.env[name] || (fallback ? process.env[fallback] : undefined);
}

function resolveAuthorityCredentials() {
  const key =
    getEnv('DUMMY_STORACHA_KEY') ||
    getEnv('ALICE_STORACHA_KEY') ||
    getEnv('STORACHA_KEY') ||
    getEnv('NEXT_PUBLIC_STORACHA_PRIVATE_KEY');
  const proof =
    getEnv('DUMMY_STORACHA_PROOF') ||
    getEnv('ALICE_STORACHA_PROOF') ||
    getEnv('STORACHA_PROOF') ||
    getEnv('NEXT_PUBLIC_STORACHA_DELEGATION');
  const spaceDid =
    getEnv('DUMMY_STORACHA_SPACE_DID') ||
    getEnv('ALICE_STORACHA_SPACE_DID') ||
    getEnv('STORACHA_SPACE_DID');

  if (!key || !proof) {
    throw new Error(
      'Missing authority credentials. Set ALICE_STORACHA_KEY/PROOF (or STORACHA_KEY/PROOF).'
    );
  }

  return { key, proof, spaceDid };
}

function toMultibaseBase64(bytes) {
  return `m${Buffer.from(bytes).toString('base64')}`;
}

async function archiveDelegationToMultibase(delegation) {
  const archived = await delegation.archive();
  if (!archived?.ok) {
    throw new Error('Failed to archive delegation');
  }
  return toMultibaseBase64(archived.ok);
}

async function createDelegationProof(client, targetDid, capabilities, expirationSeconds) {
  const audience = Verifier.parse(targetDid);
  const delegation = await client.createDelegation(audience, capabilities, {
    expiration: Math.floor(Date.now() / 1000) + expirationSeconds,
  });
  return archiveDelegationToMultibase(delegation);
}

function patchDelegationManager(content, constants) {
  const start = content.indexOf('const DUMMY_VARSIG_TESTER');
  const end = content.indexOf('} as const;', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not find DUMMY_VARSIG_TESTER block to patch');
  }

  const block = content.slice(start, end);
  const patched = block
    .replace(/(\\n\\s*key:\\s*)'[^']*'/, `$1'${constants.credentials.key}'`)
    .replace(/(\\n\\s*proof:\\s*)'[^']*'/, `$1'${constants.credentials.proof}'`)
    .replace(/(\\n\\s*spaceDid:\\s*)'[^']*'/, `$1'${constants.credentials.spaceDid}'`)
    .replace(/(\\n\\s*ed25519:\\s*)'did:key:[^']*'/, `$1'${constants.targetDids.ed25519}'`)
    .replace(/(\\n\\s*p256:\\s*)'did:key:[^']*'/, `$1'${constants.targetDids.p256}'`);

  return content.slice(0, start) + patched + content.slice(end);
}

async function main() {
  const shouldPatch = process.argv.includes('--patch-delegation-manager');
  const capabilities = ['upload/list'];
  const oneHour = 60 * 60;
  // For probing server support we want a long-lived delegation chain.
  // Note: we use 365d years to avoid calendar complexity.
  const twoYears = 2 * 365 * 24 * oneHour;

  const targetEd25519 = process.env.DUMMY_TARGET_DID_ED25519 || DEFAULT_TARGET_ED25519;
  const targetP256 = process.env.DUMMY_TARGET_DID_P256 || DEFAULT_TARGET_P256;

  const authority = resolveAuthorityCredentials();
  const authorityPrincipal = Ed25519.parse(authority.key);
  const authorityStore = new StoreMemory();
  const authorityClient = await Client.create({
    principal: authorityPrincipal,
    store: authorityStore,
  });

  const authorityProof = await Proof.parse(authority.proof);
  const authoritySpace = await authorityClient.addSpace(authorityProof);
  await authorityClient.setCurrentSpace(authoritySpace.did());

  const dummyPrincipal = await Ed25519.generate();

  const dummyBaseDelegation = await authorityClient.createDelegation(dummyPrincipal, capabilities, {
    expiration: Math.floor(Date.now() / 1000) + twoYears,
  });
  const dummyProof = await archiveDelegationToMultibase(dummyBaseDelegation);

  const dummyStore = new StoreMemory();
  const dummyClient = await Client.create({
    principal: dummyPrincipal,
    store: dummyStore,
  });
  const dummySpace = await dummyClient.addSpace(dummyBaseDelegation);
  await dummyClient.setCurrentSpace(dummySpace.did());

  const ed25519ProbeProof = await createDelegationProof(
    dummyClient,
    targetEd25519,
    capabilities,
    twoYears
  );
  const p256ProbeProof = await createDelegationProof(dummyClient, targetP256, capabilities, twoYears);

  const result = {
    credentials: {
      key: Ed25519.format(dummyPrincipal),
      proof: dummyProof,
      spaceDid: authority.spaceDid || authoritySpace.did(),
    },
    targetDids: {
      ed25519: targetEd25519,
      p256: targetP256,
    },
    probeDelegations: {
      ed25519: ed25519ProbeProof,
      p256: p256ProbeProof,
    },
  };

  if (shouldPatch) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const managerPath = path.resolve(__dirname, '../src/components/DelegationManager.tsx');
    const current = await fs.readFile(managerPath, 'utf8');
    const patched = patchDelegationManager(current, result);
    await fs.writeFile(managerPath, patched, 'utf8');
    console.log(`Patched ${managerPath}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
