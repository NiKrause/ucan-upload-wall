#!/usr/bin/env node
/**
 * Generate a local service DID for development
 * 
 * This creates a did:key that can be used as VITE_UPLOAD_SERVICE_DID
 * in your .env file for local testing.
 */

import { Signer } from '@storacha/client/principal/ed25519'

async function main() {
  console.log('🔑 Generating local service DID...\n')
  
  const signer = await Signer.generate()
  const did = signer.did()
  
  console.log('Generated Service DID:')
  console.log(did)
  console.log()
  console.log('Update your .env file with:')
  console.log(`VITE_UPLOAD_SERVICE_DID=${did}`)
  console.log()
  console.log('⚠️  Note: Save this DID - you\'ll need to use the same key')
  console.log('   when starting your local upload-service.')
}

main().catch(console.error)
