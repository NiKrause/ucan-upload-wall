#!/usr/bin/env node
/**
 * Test Script: Create Delegation for UCAN Upload Wall with Localhost
 * 
 * This script creates a UCAN delegation using the Storacha client API and exports
 * it as a multibase-encoded CAR file that can be imported in the UI.
 * 
 * Prerequisites:
 * 1. Local upload-service running at http://localhost:8787
 *    Start with: cd /Users/nandi/upload-service/packages/upload-api && node local-server.js
 * 
 * 2. Install dependencies:
 *    cd /Users/nandi/ucan-upload-wall/web && npm install
 * 
 * Usage:
 *    node test-local-delegation.js [your-did-from-ui]
 * 
 * Example:
 *    node test-local-delegation.js did:key:z6MkwAbc123...
 * 
 * Key Features:
 * - Creates a space locally
 * - Uses client.createDelegation() for proper proof chaining
 * - Exports as multibase-encoded CAR file (Storacha CLI compatible)
 * - Shows detailed delegation info before outputting the proof
 * - Better error handling and diagnostics
 * 
 * Note: For authorization to work, the local service must either:
 * - Have requirePaymentPlan: false and auto-accept spaces, OR
 * - The space must be provisioned separately (see docs/local-dev.md)
 */

import * as Client from '@storacha/client'
import { Signer } from '@storacha/client/principal/ed25519'
import * as UcantoClient from '@ucanto/client'
import { CAR, HTTP } from '@ucanto/transport'
import * as DID from '@ipld/dag-ucan/did'
import { StoreMemory } from '@storacha/client/stores/memory'
import { Verifier, Absentee } from '@ucanto/principal'
import { delegate } from '@ucanto/core'
import * as Provider from '@storacha/capabilities/provider'
import * as UCAN from '@storacha/capabilities/ucan'
import * as DidMailto from '@storacha/did-mailto'

// Configuration
const LOCAL_SERVICE_URL = 'http://localhost:8787'
// IMPORTANT: Update this with your actual local service DID from the server output
// Run: node /Users/nandi/upload-service/packages/upload-api/local-server.js
// And copy the DID it prints
const LOCAL_SERVICE_DID = process.env.LOCAL_SERVICE_DID || 'did:web:test.up.storacha.network'
const LOCAL_SERVICE_KEY = process.env.LOCAL_SERVICE_KEY || ''

function isDidWeb(did) {
  return typeof did === 'string' && did.startsWith('did:web:')
}

async function createAuthorization({ account, agent, service }) {
  const authorization = await delegate({
    issuer: account,
    audience: agent,
    capabilities: [
      {
        with: 'ucan:*',
        can: '*',
      },
    ],
    expiration: Infinity,
  })

  const attest = await UCAN.attest
    .invoke({
      issuer: service,
      audience: agent,
      with: service.did(),
      nb: {
        proof: authorization.cid,
      },
      expiration: Infinity,
    })
    .delegate()

  return [authorization, attest]
}

async function provisionSpace({ service, agent, space, connection }) {
  if (!isDidWeb(service.did())) {
    console.log('⚠️  Service DID is not did:web; skipping provisioning:', service.did())
    console.log('   Use a local server with did:web or provide a service key that matches.')
    return { skipped: true }
  }

  const accountDid = DidMailto.fromEmail('test@example.com')
  const account = Absentee.from({ id: accountDid })

  console.log('🔐 Provisioning space with service...')
  console.log('  Account:', accountDid)
  console.log('  Space:', space.did())
  console.log('  Provider:', service.did())

  const proofs = await createAuthorization({ account, agent, service })

  const result = await Provider.add.invoke({
    issuer: agent,
    audience: service,
    with: account.did(),
    nb: {
      provider: service.did(),
      consumer: space.did(),
    },
    proofs,
  }).execute(connection)

  if (result.out?.error) {
    throw new Error(`Provisioning failed: ${result.out.error.message}`, { cause: result.out.error })
  }

  console.log('✅ Space provisioned successfully')
  return { ok: true }
}

/**
 * Create a connection to the service
 */
function createConnection(url, did) {
  return UcantoClient.connect({
    id: DID.parse(did),
    codec: CAR.outbound,
    channel: HTTP.open({
      url: new URL(url),
      method: 'POST',
      headers: {
        'X-Client': 'UCAN-Upload-Wall-Test/1',
      },
    }),
  })
}

/**
 * Main function
 */
async function main() {
  console.log('╔════════════════════════════════════════════╗')
  console.log('║  🎫 Create Test Delegation - Localhost    ║')
  console.log('╚════════════════════════════════════════════╝')
  console.log()

  // Get target DID from command line
  const targetDID = process.argv[2]
  
  if (!targetDID) {
    console.error('❌ Error: No DID provided')
    console.log()
    console.log('Usage:')
    console.log('  node test-local-delegation.js <your-did-from-ui>')
    console.log()
    console.log('Steps:')
    console.log('  1. Open UCAN Upload Wall UI (http://localhost:5173)')
    console.log('  2. Click "Authenticate with Biometric"')
    console.log('  3. Copy your Ed25519 DID from the UI')
    console.log('  4. Run: node test-local-delegation.js <your-did>')
    console.log()
    process.exit(1)
  }
  
  console.log('📋 Configuration')
  console.log('  Service URL:', LOCAL_SERVICE_URL)
  console.log('  Service DID:', LOCAL_SERVICE_DID)
  if (LOCAL_SERVICE_KEY) {
    console.log('  Service key: provided')
  } else {
    console.log('  Service key: not set (provisioning will be skipped)')
  }
  console.log('  Target DID:', targetDID)
  console.log()

  // Step 1: Generate a principal (this will be the issuer)
  console.log('🔑 Generating principal...')
  const principal = await Signer.generate()
  console.log('  Principal DID:', principal.did())
  console.log()

  // Step 2: Create connection
  console.log('📡 Connecting to local service...')
  const connection = createConnection(LOCAL_SERVICE_URL, LOCAL_SERVICE_DID)
  console.log('  ✅ Connection created')
  console.log()

  // Step 3: Create client
  console.log('🔧 Creating Storacha client...')
  const client = await Client.create({
    principal,
    store: new StoreMemory(),
    serviceConf: {
      access: connection,
      upload: connection,
      filecoin: connection,
    },
    receiptsEndpoint: new URL('http://localhost:9201'), // Mock
  })
  console.log('  ✅ Client created')
  console.log()

  // Step 4: Create a space
  console.log('🏗️  Creating space...')
  try {
    const space = await client.createSpace('test-space', {
      skipGatewayAuthorization: true,
    })
    
    const auth = await space.createAuthorization(client)
    await client.addSpace(auth)
    await client.setCurrentSpace(space.did())
    
    console.log('  Space DID:', space.did())
    console.log('  ✅ Space created locally')
    console.log()

    // Step 4.5: Provision the space with the service (required for upload/add)
    if (LOCAL_SERVICE_KEY) {
      const serviceSigner = Signer.parse(LOCAL_SERVICE_KEY)
      await provisionSpace({
        service: serviceSigner,
        agent: principal,
        space,
        connection,
      })
      console.log()
    } else {
      console.log('⚠️  Skipping space provisioning (missing LOCAL_SERVICE_KEY)')
      console.log('   Upload/add will be rejected until the space is provisioned.')
      console.log()
    }

    // Step 5: Create delegation directly from the space signer
    // This ensures the issuer is the space DID and avoids missing-chain issues.
    console.log('🎫 Creating delegation for:', targetDID)
    
    // Keep capabilities to the minimum required for upload.
    const capabilities = [
      'upload/list',
      'space/blob/add',
      'space/blob/list',
      'space/index/add',
      'space/index/list',
      'filecoin/offer',
      'upload/add',
      'upload/list',
    ]
    
    console.log('  Capabilities:')
    capabilities.forEach(cap => console.log(`    - ${cap}`))
    console.log()
    
    console.log('📝 Creating delegation using Storacha client...')
    console.log('  Space DID:', space.did())
    console.log('  Target DID:', targetDID)
    console.log()

    // Parse the audience as a Verifier (it needs the .did() method)
    const audience = Verifier.parse(targetDID)
    
    // Calculate far-future expiration (100 years from now)
    // NOTE: Can't use Infinity as it breaks serialization/deserialization
    const now = Math.floor(Date.now() / 1000)
    const oneHundredYears = 100 * 365 * 24 * 60 * 60
    const farFutureExpiration = now + oneHundredYears
    
    console.log('  Expiration set to:', new Date(farFutureExpiration * 1000).toISOString())
    console.log()
    
    if (!space?.signer) {
      throw new Error('Space signer not available. Cannot create space-signed delegation.')
    }

    const delegation = await delegate({
      issuer: space.signer,
      audience,
      capabilities: capabilities.map(can => ({ can, with: space.did() })),
      expiration: farFutureExpiration,
    })
    
    console.log('✅ Delegation created!')
    console.log()
    
    // Display delegation details
    console.log('╔════════════════════════════════════════════╗')
    console.log('║  📜 Delegation Details                     ║')
    console.log('╚════════════════════════════════════════════╝')
    console.log()
    console.log('  Issuer:', delegation.issuer.did())
    console.log('  Audience:', delegation.audience.did())
    if (delegation.proofs) {
      console.log('  Proofs:', delegation.proofs.length)
    }
    console.log('  Expiration:', new Date(delegation.expiration * 1000).toISOString())
    console.log('  (Valid for ~100 years)')
    console.log()
    console.log('  Capabilities:')
    for (const capability of delegation.capabilities) {
      console.log(`    - ${capability.can}`)
      console.log(`      with: ${capability.with}`)
      if (capability.nb && Object.keys(capability.nb).length > 0) {
        console.log(`      caveats:`, JSON.stringify(capability.nb, null, 2).split('\n').map((line, i) => i === 0 ? line : `               ${line}`).join('\n'))
      }
    }
    console.log()

    // Archive to CAR format and encode
    console.log('📦 Archiving delegation to CAR format...')
    const archiveResult = await delegation.archive()
    
    // Handle the archive result (might be wrapped in {ok: ...} or direct Uint8Array)
    let carBytes
    if (archiveResult && typeof archiveResult === 'object' && 'ok' in archiveResult) {
      carBytes = archiveResult.ok
    } else if (archiveResult instanceof Uint8Array) {
      carBytes = archiveResult
    } else {
      throw new Error('Unexpected archive result format')
    }
    
    if (!carBytes || carBytes.length === 0) {
      throw new Error('Delegation archive resulted in empty bytes')
    }
    
    console.log('  CAR bytes length:', carBytes.length)
    
    // Convert to base64 and add multibase 'm' prefix (matching UI implementation)
    const base64 = Buffer.from(carBytes).toString('base64')
    const proofBase64 = 'm' + base64
    
    console.log('  Base64 length:', base64.length)
    console.log('  Multibase proof length:', proofBase64.length)
    console.log('  First 50 chars:', proofBase64.substring(0, 50))
    console.log()
    console.log('✅ Delegation ready to share!')
    console.log()
    console.log('╔════════════════════════════════════════════╗')
    console.log('║  📋 Delegation Proof (Copy This!)         ║')
    console.log('╚════════════════════════════════════════════╝')
    console.log()
    console.log(proofBase64)
    console.log()
    console.log('╔════════════════════════════════════════════╗')
    console.log('║  📝 Next Steps                             ║')
    console.log('╚════════════════════════════════════════════╝')
    console.log()
    console.log('1. Copy the delegation proof above (starts with "m")')
    console.log('2. Open UCAN Upload Wall UI (http://localhost:5173)')
    console.log('3. Click "Import UCAN Delegation" button')
    console.log('4. Paste the proof in the text area')
    console.log('5. (Optional) Give it a friendly name')
    console.log('6. Click "Import UCAN Delegation"')
    console.log('7. Try uploading a file!')
    console.log()
    console.log('✅ Format: Multibase-encoded CAR file (compatible with Storacha CLI)')
    console.log('⚠️  Note: This delegation expires in ~100 years')
    console.log()

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.log()
    console.error('Full error details:', error)
    console.log()
    
    if (error.message.includes('provisions')) {
      console.error('💡 This error means billing provisions are not set up.')
      console.error('   The local server needs manual provision configuration.')
      console.error('   See docs/local-dev.md for details.')
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('💡 Cannot connect to local server.')
      console.error('   Make sure the server is running:')
      console.error('   cd /Users/nandi/upload-service/packages/upload-api')
      console.error('   node local-server.js')
    } else if (error.message.includes('archive')) {
      console.error('💡 Delegation archiving failed.')
      console.error('   This might be a serialization issue.')
      console.error('   Check that all delegation fields are properly formatted.')
    } else if (error.message.includes('parse') || error.message.includes('DID')) {
      console.error('💡 Invalid target DID format.')
      console.error('   Make sure the DID starts with "did:key:" and is valid.')
      console.error('   Get the DID from the UI after authentication.')
    }
    
    console.log()
    process.exit(1)
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
