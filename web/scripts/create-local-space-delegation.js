#!/usr/bin/env node
/**
 * Create a delegation for local testing
 * 
 * This creates a simple delegation without provisioning on the server.
 * The local server accepts any delegation for testing purposes.
 * 
 * Usage:
 *   node scripts/create-local-space-delegation.js <audience-did>
 */

import * as Ed25519 from '@ucanto/principal/ed25519'
import * as Space from '@storacha/capabilities/space'
import { Delegation } from '@ucanto/core'
import { Verifier } from '@ucanto/principal'
import { CAR } from '@ucanto/transport'

async function main() {
  const audienceDID = process.argv[2]
  
  if (!audienceDID || !audienceDID.startsWith('did:key:')) {
    console.error('❌ Usage: node scripts/create-local-space-delegation.js <audience-did>')
    console.error('   Example: node scripts/create-local-space-delegation.js did:key:z6MkeW5WgykoNM7TQytQMkUwL1zMZVgKwFKHtCYka2huGp76')
    process.exit(1)
  }

  console.log('🔧 Creating delegation for local testing...')
  console.log('👤 Audience DID:', audienceDID)
  console.log()

  // Generate a space
  const space = await Ed25519.generate()
  console.log('✅ Generated space:', space.did())
  
  // Parse audience
  const audience = Verifier.parse(audienceDID)

  // Create delegation with full space capabilities
  console.log('🎫 Creating delegation...')
  
  const delegation = await Space.top.delegate({
    issuer: space,
    audience,
    with: space.did(),
    expiration: Infinity,
  })

  console.log('✅ Delegation created!')
  console.log()
  console.log('📋 Delegation Details:')
  console.log('   Space:', space.did())
  console.log('   From:', space.did())
  console.log('   To:', audienceDID)
  console.log('   Capabilities: space/* (all space capabilities)')
  console.log()
  
  // Encode as CAR
  const carBytes = await CAR.outbound.encode(delegation)
  const base64 = Buffer.from(carBytes).toString('base64')
  
  console.log('📤 Delegation (Base64 CAR - import this in your browser):')
  console.log()
  console.log(base64)
  console.log()
  console.log('💡 To import in browser:')
  console.log('   1. Open http://localhost:5173')
  console.log('   2. Click "Import Delegation"')
  console.log('   3. Paste the base64 string above')
  console.log()
  console.log('⚠️  Note: This delegation doesn\'t provision the space on the server.')
  console.log('   Upload operations may still fail with "Unauthorized" until the')
  console.log('   space is properly provisioned.For testing, consider using the')
  console.log('   production Storacha service instead of localhost.')
  console.log()
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  console.error(err)
  process.exit(1)
})
