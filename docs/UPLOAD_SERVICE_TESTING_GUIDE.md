# Testing with Storacha Upload Service

## Overview

This guide explains how to run the Storacha upload service in tests and perform common operations like creating spaces, delegations, and revocations. This is based on the testing patterns used in the `storacha/upload-service` repository.

## Architecture

The Storacha upload service tests **do not use Docker Compose**. Instead, they:
- Create in-memory test servers programmatically using UCANTO protocol
- Use HTTP servers that wrap the upload-api for integration testing
- Support both low-level API testing and CLI-based testing

## Prerequisites

```json
{
  "dependencies": {
    "@storacha/upload-api": "^2.8.4",
    "@ucanto/principal": "^9.0.0",
    "@ucanto/server": "^9.0.0",
    "@ucanto/client": "^9.0.0",
    "@ucanto/transport": "^9.0.0",
    "@ucanto/core": "^9.0.0",
    "@storacha/capabilities": "^17.0.0"
  }
}
```

## Approach 1: Low-Level API Testing

### Setting Up the Test Upload Service

```javascript
import { createContext, cleanupContext } from '@storacha/upload-api/test/context'
import { createServer, connect } from '@storacha/upload-api'
import * as Signer from '@ucanto/principal/ed25519'

// Create the upload service context with all necessary storage and services
async function setupUploadService() {
  const context = await createContext({
    requirePaymentPlan: false // set to true to test payment plans
  })
  
  return context
}

// Clean up after tests
async function teardownUploadService(context) {
  await cleanupContext(context)
}

// Example test wrapper
async function test(fn) {
  const context = await setupUploadService()
  try {
    await fn(context)
  } finally {
    await teardownUploadService(context)
  }
}
```

### Creating a Space

```javascript
import { ed25519 } from '@ucanto/principal'
import { delegate } from '@ucanto/core'
import { Absentee } from '@ucanto/principal'

/**
 * Create a space and register it with the upload service
 */
async function createAndRegisterSpace(context, agentSigner, accountEmail = 'alice@test.mail') {
  // Generate a new space identity
  const space = await ed25519.generate()
  const spaceDid = space.did()
  
  // Create a delegation giving the agent full access to the space
  const spaceProof = await delegate({
    issuer: space,
    audience: agentSigner,
    capabilities: [{ can: '*', with: spaceDid }],
  })
  
  // Create an account identity
  const account = Absentee.from({
    id: `did:mailto:test.storacha.network:${accountEmail}`,
  })
  
  // Connect to the upload service
  const connection = connect({
    id: context.id,
    channel: createServer(context),
  })
  
  // Provision the space (links space to account and provider)
  const provisionResult = await context.provisionsStorage.put({
    cause: spaceProof.cid,
    consumer: spaceDid,
    customer: account.did(),
    provider: context.id.did(),
  })
  
  return {
    space,
    spaceDid,
    spaceProof,
    account,
    connection
  }
}
```

### Creating a Delegation

```javascript
import { delegate } from '@ucanto/core'
import * as StoreCapabilities from '@storacha/capabilities/store'
import * as UploadCapabilities from '@storacha/capabilities/upload'

/**
 * Create a delegation from one principal to another
 */
async function createDelegation(space, issuer, audience, capabilities = null) {
  // Default to store and upload capabilities if not specified
  const caps = capabilities || [
    StoreCapabilities.add.create({
      with: space.spaceDid,
      caveats: {}
    }),
    UploadCapabilities.add.create({
      with: space.spaceDid,
      caveats: {}
    })
  ]
  
  const delegation = await delegate({
    issuer: issuer,
    audience: audience,
    capabilities: caps,
    proofs: [space.spaceProof], // Include proof that issuer has authority
    expiration: Infinity,
  })
  
  return delegation
}

/**
 * Alternative: Create delegation with capability strings
 */
async function createDelegationSimple(spaceDid, issuer, audience, proofs) {
  return await delegate({
    issuer: issuer,
    audience: audience,
    capabilities: [
      { can: 'store/*', with: spaceDid },
      { can: 'upload/*', with: spaceDid }
    ],
    proofs: proofs,
    expiration: Infinity,
  })
}
```

### Revoking a Delegation

```javascript
import { UCAN } from '@storacha/capabilities'

/**
 * Revoke a delegation
 */
async function revokeDelegation(context, issuer, delegationToRevoke) {
  const connection = connect({
    id: context.id,
    channel: createServer(context),
  })
  
  // Invoke the revocation capability
  const revocation = await UCAN.revoke
    .invoke({
      issuer: issuer,
      audience: context.id,
      with: issuer.did(),
      nb: {
        ucan: delegationToRevoke.cid, // CID of the delegation to revoke
      },
      proofs: [delegationToRevoke], // Must have access to the delegation
    })
    .execute(connection)
  
  if (revocation.out.error) {
    throw new Error('Failed to revoke delegation', { cause: revocation.out.error })
  }
  
  return revocation.out.ok
}
```

### Complete Low-Level Test Example

```javascript
import * as assert from 'assert'
import { ed25519 } from '@ucanto/principal'
import { UCAN, Console } from '@storacha/capabilities'
import { createContext, cleanupContext } from '@storacha/upload-api/test/context'
import { createServer, connect } from '@storacha/upload-api'

async function testDelegationRevocation() {
  // Setup
  const context = await createContext()
  const alice = await ed25519.generate()
  const bob = await ed25519.generate()
  
  try {
    // Create a delegation from context service to alice
    const proof = await Console.log.delegate({
      issuer: context.id,
      audience: alice,
      with: context.id.did(),
    })
    
    // Verify alice can use the delegation
    const success = await Console.log
      .invoke({
        issuer: alice,
        audience: context.id,
        with: context.id.did(),
        nb: { value: 'hello' },
        proofs: [proof],
      })
      .execute(context.connection)
    
    assert.deepEqual(success.out, { ok: 'hello' })
    
    // Revoke the delegation
    const revoke = await UCAN.revoke
      .invoke({
        issuer: context.id,
        audience: context.id,
        with: context.id.did(),
        nb: {
          ucan: proof.cid,
        },
        proofs: [proof],
      })
      .execute(context.connection)
    
    assert.ok(revoke.out.ok?.time, 'Revocation should succeed')
    
    // Verify alice can no longer use the revoked delegation
    const failure = await Console.log
      .invoke({
        issuer: alice,
        audience: context.id,
        with: context.id.did(),
        nb: { value: 'bye' },
        proofs: [proof],
      })
      .execute(context.connection)
    
    assert.ok(
      failure.out.error?.message.includes('has been revoked'),
      'Using revoked delegation should fail'
    )
    
    console.log('✓ Delegation revocation test passed')
  } finally {
    await cleanupContext(context)
  }
}
```

## Approach 2: HTTP Server Testing (CLI-Style)

For integration testing with an HTTP endpoint (like testing a CLI):

### Setting Up HTTP Server

```javascript
import http from 'node:http'
import { once } from 'node:events'
import { createContext, cleanupContext } from '@storacha/upload-api/test/context'
import { createServer as createHTTPServer } from './http-server.js' // see below

async function setupHTTPUploadService() {
  const context = await createContext({ http })
  
  // Create HTTP server that wraps the UCANTO connection
  const { server, serverURL } = await createHTTPServer({
    '/': context.connection.channel.request.bind(context.connection.channel),
  })
  
  return {
    ...context,
    server,
    serverURL
  }
}

async function teardownHTTPUploadService(context) {
  await cleanupContext(context)
  context.server.close()
}
```

### HTTP Server Implementation

```javascript
// http-server.js - minimal HTTP wrapper for UCANTO
import http from 'node:http'
import { once } from 'node:events'

export async function createServer(router) {
  const listener = async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }
    
    const handler = router[request.url ?? '/']
    if (!handler) {
      response.writeHead(404)
      response.end()
      return
    }
    
    const { headers, body } = await handler({
      headers: request.headers,
      body: Buffer.concat(chunks),
    })
    
    response.writeHead(200, headers)
    response.write(body)
    response.end()
  }
  
  const server = http.createServer(listener).listen()
  await once(server, 'listening')
  
  return {
    server,
    serverURL: new URL(`http://127.0.0.1:${server.address().port}`),
  }
}
```

### Using with Storacha Client

```javascript
import * as Client from '@storacha/client'

async function testWithStorachaClient() {
  const context = await setupHTTPUploadService()
  
  try {
    // Create client pointing to test service
    const client = await Client.create({
      serviceConf: {
        access: context.serverURL,
        upload: context.serverURL,
      },
      receiptsEndpoint: context.serverURL,
    })
    
    // Create a space
    const space = await client.createSpace('test-space')
    await client.setCurrentSpace(space.did())
    
    // Create a delegation
    const delegation = await client.delegate({
      abilities: ['store/add', 'upload/add'],
      audience: 'did:key:z6MkqOtherAgent...',
    })
    
    // Revoke the delegation
    const result = await client.revokeDelegation(delegation.cid)
    
    console.log('Revocation result:', result)
  } finally {
    await teardownHTTPUploadService(context)
  }
}
```

## Testing Upload Operations

```javascript
import * as Client from '@storacha/client'
import { filesFromPaths } from 'files-from-path'

async function testUpload(context) {
  const client = await Client.create({
    serviceConf: {
      access: context.serverURL,
      upload: context.serverURL,
    },
  })
  
  const space = await client.createSpace('uploads')
  await client.setCurrentSpace(space.did())
  
  // Upload a file
  const files = [
    new File(['hello world'], 'hello.txt', { type: 'text/plain' })
  ]
  
  const cid = await client.uploadDirectory(files)
  console.log('Uploaded with CID:', cid)
  
  // List uploads
  const uploads = await client.capability.upload.list()
  console.log('Uploads:', uploads)
}
```

## Common Test Patterns

### Test Fixtures: Pre-generated Signers

```javascript
import { ed25519 } from '@ucanto/principal'

// Use consistent test identities
export const alice = ed25519.parse(
  'MgCZT5vOnYZoVAeyjnzuJIVY9J4LNtJ+f8Js0cTPuKUpFne0BVEDJjEu6quFIU8yp91/TY/+MYK8GvlKoTDnqOCovCVM='
)
// did:key:z6Mkk89bC3JrVqKie71YEcc5M1SMVxuCgNx6zLZ8SYJsxALi

export const bob = ed25519.parse(
  'MgCYbj5AJfVvdrjkjNCxB3iAUwx7RQHVQ7H1sKyHy46Iose0BEevXgL1V73PD9snOCIoONgb+yQ9sycYchQC8kygR4qY='
)
// did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob

export const mallory = ed25519.parse(
  'MgCYtH0AvYxiQwBG6+ZXcwlXywq9tI50G2mCAUJbwrrahkO0B0elFYkl3Ulf3Q3A/EvcVY0utb4etiSE8e6pi4H0FEmU='
)
// did:key:z6MktafZTREjJkvV5mfJxcLpNBoVPwDLhTuMg9ng7dY4zMAL
```

### Verifying Revocation Works

```javascript
async function verifyRevocationWorks(context, delegationToTest, issuer) {
  const connection = context.connection
  
  // Test that delegation works before revocation
  const beforeRevoke = await Console.log
    .invoke({
      issuer: issuer,
      audience: context.id,
      with: context.id.did(),
      nb: { value: 'test' },
      proofs: [delegationToTest],
    })
    .execute(connection)
  
  assert.ok(beforeRevoke.out.ok, 'Delegation should work before revocation')
  
  // Revoke it
  await UCAN.revoke
    .invoke({
      issuer: context.id,
      audience: context.id,
      with: context.id.did(),
      nb: { ucan: delegationToTest.cid },
      proofs: [delegationToTest],
    })
    .execute(connection)
  
  // Test that it fails after revocation
  const afterRevoke = await Console.log
    .invoke({
      issuer: issuer,
      audience: context.id,
      with: context.id.did(),
      nb: { value: 'test' },
      proofs: [delegationToTest],
    })
    .execute(connection)
  
  assert.ok(
    afterRevoke.out.error?.message.includes('has been revoked'),
    'Delegation should fail after revocation'
  )
}
```

## Key Points for External Projects

1. **No Docker Required**: All services run in-process using JavaScript/Node.js
2. **In-Memory Storage**: Test contexts use in-memory storage by default (maps/arrays)
3. **Fast Execution**: Tests run quickly without container startup overhead
4. **Isolated Tests**: Each test gets its own context with isolated storage
5. **UCANTO Protocol**: Everything uses UCANTO invocations and delegations
6. **Multiple Approaches**: Choose low-level API testing or HTTP integration testing

## Revocation Rules

- **Issuer** of a delegation can always revoke it
- **Audience** of a delegation can revoke it (revoking their own access)
- Must have access to the delegation UCAN (either generated by the agent or passed as proof)
- Revocations are checked on every invocation validation
- Revoked delegations cannot be used as proofs

## Storage Implementations

The test context provides these storage implementations:

- `provisionsStorage` - Space provisioning/account relationships
- `delegationsStorage` - Stores delegations
- `revocationsStorage` - Stores revocation records
- `subscriptionsStorage` - Payment plan subscriptions
- `allocationsStorage` - Blob allocations
- `uploadsStorage` - Upload records

All are in-memory by default but can be swapped with persistent implementations.

## External Services

The test context also provides mock implementations of:

- Email service (for authorization flows)
- Content claims service
- Indexing service
- Rate limiting service

These can be customized or replaced for specific test scenarios.

## Example Test File Structure

```javascript
// test/upload-service.test.js
import { test } from 'node:test'
import * as assert from 'node:assert'
import { ed25519 } from '@ucanto/principal'
import { createContext, cleanupContext } from '@storacha/upload-api/test/context'

test('space creation and delegation', async (t) => {
  const context = await createContext()
  
  t.after(async () => {
    await cleanupContext(context)
  })
  
  await t.test('can create space', async () => {
    const agent = await ed25519.generate()
    // ... test implementation
  })
  
  await t.test('can delegate capabilities', async () => {
    // ... test implementation
  })
  
  await t.test('can revoke delegation', async () => {
    // ... test implementation
  })
})
```

## Real-World Test Examples from Upload Service

### CLI Delegation Revocation Test

From `packages/cli/test/bin.spec.js`:

```javascript
'storacha delegation revoke': test(async (assert, context) => {
  const env = context.env.alice
  const { mallory } = Test
  await loginAndCreateSpace(context)

  const delegationPath = `${os.tmpdir()}/delegation-${Date.now()}.ucan`
  await storacha
    .args([
      'delegation',
      'create',
      mallory.did(),
      '-c',
      'store/*',
      'upload/*',
      '-o',
      delegationPath,
    ])
    .env(env)
    .join()

  const list = await storacha
    .args(['delegation', 'ls', '--json'])
    .env(context.env.alice)
    .join()
  const { cid } = JSON.parse(list.output)

  // alice should be able to revoke the delegation she just created
  const revoke = await storacha
    .args(['delegation', 'revoke', cid])
    .env(context.env.alice)
    .join()

  assert.match(revoke.output, /delegation .* revoked/)

  // bob should not be able to because he doesn't have a copy of the delegation
  await loginAndCreateSpace(context, {
    env: context.env.bob,
    customer: 'bob@super.host',
  })

  const fail = await storacha
    .args(['delegation', 'revoke', cid])
    .env(context.env.bob)
    .join()
    .catch()

  assert.match(
    fail.error,
    /Error: revoking .* could not find delegation/
  )

  // but if bob passes the delegation manually, it should succeed
  const pass = await storacha
    .args(['delegation', 'revoke', cid, '-p', delegationPath])
    .env(context.env.bob)
    .join()

  assert.match(pass.output, /delegation .* revoked/)
})
```

### Upload API Test Structure

From `packages/upload-api/src/test/handlers/ucan.js`:

```javascript
export const test = {
  'issuer can revoke delegation': async (assert, context) => {
    const proof = await Console.log.delegate({
      issuer: context.id,
      audience: alice,
      with: context.id.did(),
    })

    const success = await Console.log
      .invoke({
        issuer: alice,
        audience: context.id,
        with: context.id.did(),
        nb: { value: 'hello' },
        proofs: [proof],
      })
      .execute(context.connection)

    assert.deepEqual(success.out, { ok: 'hello' })

    const revoke = await UCAN.revoke
      .invoke({
        issuer: context.id,
        audience: context.id,
        with: context.id.did(),
        nb: {
          ucan: proof.cid,
        },
        proofs: [proof],
      })
      .execute(context.connection)

    assert.ok(revoke.out.ok?.time)

    const failure = await Console.log
      .invoke({
        issuer: alice,
        audience: context.id,
        with: context.id.did(),
        nb: { value: 'bye' },
        proofs: [proof],
      })
      .execute(context.connection)

    assert.ok(failure.out.error?.message.includes('has been revoked'))
  },

  'audience can revoke delegation': async (assert, context) => {
    const proof = await Console.log.delegate({
      issuer: context.id,
      audience: alice,
      with: context.id.did(),
    })

    const revoke = await UCAN.revoke
      .invoke({
        issuer: alice,
        audience: context.id,
        with: alice.did(),
        nb: {
          ucan: proof.cid,
        },
        proofs: [proof],
      })
      .execute(context.connection)

    assert.ok(revoke.out.ok?.time)
  },
}
```

## Resources

- [Upload Service Repository](https://github.com/storacha/upload-service)
- [UCANTO Protocol](https://github.com/web3-storage/ucanto)
- [Test Examples](https://github.com/storacha/upload-service/tree/main/packages/upload-api/src/test)
- [Storacha Documentation](https://docs.storacha.network)
- [CLI Package](https://github.com/storacha/upload-service/tree/main/packages/cli)
- [Upload API Package](https://github.com/storacha/upload-service/tree/main/packages/upload-api)

## Summary

The Storacha upload service testing approach prioritizes:

- **Simplicity**: No Docker or container orchestration needed
- **Speed**: In-memory operations are fast
- **Flexibility**: Easy to mock and customize any component
- **Isolation**: Each test has its own independent context
- **Reusability**: Test utilities are exported for external projects

External projects can import `@storacha/upload-api/test/context` and immediately start testing against a fully functional upload service without any additional infrastructure setup.

