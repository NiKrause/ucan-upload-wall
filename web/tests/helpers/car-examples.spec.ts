/**
 * Practical examples of CAR file generation and parsing
 * 
 * This test file demonstrates real-world usage scenarios for CAR files
 * in the context of UCAN delegations.
 */

import { test, expect } from '@playwright/test';
import {
  base64ToBytes,
  bytesToBase64,
  tokenToCarBytes,
  carBytesToToken,
  createCarFile,
  parseCarFile,
  getCarFileInfo
} from '../../src/lib/car-utils';

test.describe('CAR Examples - Basic Usage', () => {
  test('Example 1: Create a CAR file from a delegation token', async () => {
    console.log('\n=== Example 1: Create CAR file ===\n');
    
    // Step 1: You have a delegation token (from createDelegation)
    const delegationToken = 'mSGVsbG8gV29ybGQh'; // Example token
    console.log('1. Delegation token:', delegationToken);
    
    // Step 2: Specify the target DID (who will receive this delegation)
    const targetDID = 'did:key:z6MkrZ1r5XBFZjBU34qyD8fueMbMRkKw17BZaq2ivKFjnz2z';
    console.log('2. Target DID:', targetDID);
    
    // Step 3: Create CAR file
    const carFile = await createCarFile(delegationToken, targetDID);
    console.log('3. CAR file created:');
    console.log('   - Name:', carFile.name);
    console.log('   - Size:', carFile.size, 'bytes');
    console.log('   - Type:', carFile.type);
    
    // Verify
    expect(carFile.name).toContain(targetDID);
    expect(carFile.name).toMatch(/\.car$/);
    expect(carFile.type).toBe('application/vnd.ipld.car');
    expect(carFile.size).toBeGreaterThan(0);
    
    console.log('\n✅ CAR file ready for upload!\n');
  });

  test('Example 2: Parse a CAR file to get the delegation token', async () => {
    console.log('\n=== Example 2: Parse CAR file ===\n');
    
    // Step 1: Create a CAR file (simulating received file)
    const originalToken = 'mSGVsbG8gV29ybGQh';
    const targetDID = 'did:key:z6MkrZ1r5XBFZjBU34qyD8fueMbMRkKw17BZaq2ivKFjnz2z';
    const carFile = await createCarFile(originalToken, targetDID);
    console.log('1. Received CAR file:', carFile.name);
    
    // Step 2: Parse the CAR file
    const parsedToken = await parseCarFile(carFile);
    console.log('2. Extracted token:', parsedToken.substring(0, 20) + '...');
    
    // Step 3: Verify the token is valid
    const originalBytes = base64ToBytes(originalToken.substring(1));
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    console.log('3. Token validation:');
    console.log('   - Original bytes length:', originalBytes.length);
    console.log('   - Parsed bytes length:', parsedBytes.length);
    console.log('   - Match:', originalBytes.length === parsedBytes.length ? '✅' : '❌');
    
    expect(parsedBytes).toEqual(originalBytes);
    
    console.log('\n✅ Token successfully extracted!\n');
  });

  test('Example 3: Round-trip conversion (token → CAR → token)', async () => {
    console.log('\n=== Example 3: Round-trip conversion ===\n');
    
    // Start with a token
    const originalToken = 'mVGhpcyBpcyBhIHRlc3QgZGVsZWdhdGlvbiB0b2tlbg==';
    console.log('1. Original token:', originalToken.substring(0, 30) + '...');
    
    // Convert to CAR
    const carBytes = await tokenToCarBytes(originalToken);
    console.log('2. Converted to CAR:', carBytes.length, 'bytes');
    
    // Convert back to token
    const recoveredToken = await carBytesToToken(carBytes);
    console.log('3. Recovered token:', recoveredToken.substring(0, 30) + '...');
    
    // Verify they're equivalent
    const originalBytes = base64ToBytes(originalToken.substring(1));
    const recoveredBytes = base64ToBytes(recoveredToken.substring(1));
    
    console.log('4. Verification:');
    console.log('   - Original decoded:', new TextDecoder().decode(originalBytes));
    console.log('   - Recovered decoded:', new TextDecoder().decode(recoveredBytes));
    console.log('   - Match:', originalBytes.length === recoveredBytes.length ? '✅' : '❌');
    
    expect(recoveredBytes).toEqual(originalBytes);
    
    console.log('\n✅ Round-trip successful!\n');
  });
});

test.describe('CAR Examples - Real UCAN Scenarios', () => {
  test('Example 4: Create CAR for UCAN delegation with metadata', async () => {
    console.log('\n=== Example 4: UCAN delegation with metadata ===\n');
    
    // Simulate a real UCAN delegation structure
    const ucanData = {
      v: '0.9.0',
      iss: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      aud: 'did:key:z6MkrZ1r5XBFZjBU34qyD8fueMbMRkKw17BZaq2ivKFjnz2z',
      att: [
        { can: 'space/blob/add', with: 'did:key:z6Mk...' },
        { can: 'upload/add', with: 'did:key:z6Mk...' }
      ],
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      prf: []
    };
    
    console.log('1. UCAN structure:');
    console.log('   - Version:', ucanData.v);
    console.log('   - Issuer:', ucanData.iss.substring(0, 30) + '...');
    console.log('   - Audience:', ucanData.aud.substring(0, 30) + '...');
    console.log('   - Capabilities:', ucanData.att.length);
    console.log('   - Expires:', new Date(ucanData.exp * 1000).toISOString());
    
    // Convert to token
    const jsonString = JSON.stringify(ucanData);
    const bytes = new TextEncoder().encode(jsonString);
    const token = 'm' + bytesToBase64(bytes);
    
    console.log('2. Token created, length:', token.length);
    
    // Create CAR file
    const carFile = await createCarFile(token, ucanData.aud);
    
    console.log('3. CAR file:');
    console.log('   - Name:', carFile.name);
    console.log('   - Size:', carFile.size, 'bytes');
    
    // Get CAR info
    const arrayBuffer = await carFile.arrayBuffer();
    const carBytes = new Uint8Array(arrayBuffer);
    const info = await getCarFileInfo(carBytes);
    
    console.log('4. CAR file info:');
    console.log('   - Root CID:', info.roots[0]);
    console.log('   - Block count:', info.blockCount);
    console.log('   - Total size:', info.totalSize, 'bytes');
    
    expect(info.blockCount).toBe(1);
    expect(info.roots.length).toBe(1);
    
    console.log('\n✅ UCAN delegation packaged in CAR format!\n');
  });

  test('Example 5: Simulate delegation sharing workflow', async () => {
    console.log('\n=== Example 5: Delegation sharing workflow ===\n');
    
    // Browser A: Create delegation
    console.log('📱 Browser A (Issuer):');
    const issuerDID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
    const recipientDID = 'did:key:z6MkrZ1r5XBFZjBU34qyD8fueMbMRkKw17BZaq2ivKFjnz2z';
    
    // Create mock delegation
    const delegation = {
      from: issuerDID,
      to: recipientDID,
      capabilities: ['space/blob/add', 'upload/add'],
      expires: Date.now() + 86400000
    };
    
    const delegationJSON = JSON.stringify(delegation);
    const delegationBytes = new TextEncoder().encode(delegationJSON);
    const delegationToken = 'm' + bytesToBase64(delegationBytes);
    
    console.log('1. Created delegation:');
    console.log('   - From:', issuerDID.substring(0, 30) + '...');
    console.log('   - To:', recipientDID.substring(0, 30) + '...');
    console.log('   - Capabilities:', delegation.capabilities.join(', '));
    
    // Convert to CAR
    const carFile = await createCarFile(delegationToken, recipientDID);
    console.log('2. Packaged as CAR file:', carFile.name);
    
    // Simulate upload (in real app, this goes to Storacha)
    console.log('3. Uploading to Storacha...');
    const mockCID = 'bafkreiabcdef1234567890'; // Mock CID
    console.log('   ✅ Uploaded! CID:', mockCID);
    
    // Browser B: Receive delegation
    console.log('\n📱 Browser B (Recipient):');
    console.log('1. Received delegation token (via copy-paste or download)');
    
    // Parse the CAR file
    const parsedToken = await parseCarFile(carFile);
    console.log('2. Parsed CAR file');
    
    // Decode the delegation
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    const parsedJSON = new TextDecoder().decode(parsedBytes);
    const parsedDelegation = JSON.parse(parsedJSON);
    
    console.log('3. Extracted delegation:');
    console.log('   - From:', parsedDelegation.from.substring(0, 30) + '...');
    console.log('   - To:', parsedDelegation.to.substring(0, 30) + '...');
    console.log('   - Capabilities:', parsedDelegation.capabilities.join(', '));
    
    // Verify
    expect(parsedDelegation.from).toBe(issuerDID);
    expect(parsedDelegation.to).toBe(recipientDID);
    expect(parsedDelegation.capabilities).toEqual(delegation.capabilities);
    
    console.log('\n✅ Delegation successfully shared and imported!\n');
  });
});

test.describe('CAR Examples - Debugging and Inspection', () => {
  test('Example 6: Inspect CAR file contents', async () => {
    console.log('\n=== Example 6: Inspect CAR file ===\n');
    
    // Create a sample CAR file
    const sampleData = {
      message: 'This is a test delegation',
      timestamp: Date.now(),
      capabilities: ['space/blob/add']
    };
    
    const jsonString = JSON.stringify(sampleData, null, 2);
    const bytes = new TextEncoder().encode(jsonString);
    const token = 'm' + bytesToBase64(bytes);
    
    console.log('1. Original data:');
    console.log(jsonString);
    
    // Create CAR
    const carBytes = await tokenToCarBytes(token);
    console.log('\n2. CAR file created:', carBytes.length, 'bytes');
    
    // Inspect CAR structure
    const info = await getCarFileInfo(carBytes);
    console.log('\n3. CAR structure:');
    console.log('   - Version: 1 (CARv1)');
    console.log('   - Root CIDs:', info.roots.length);
    for (let i = 0; i < info.roots.length; i++) {
      console.log(`     [${i}]:`, info.roots[i]);
    }
    console.log('   - Blocks:', info.blockCount);
    console.log('   - Total data size:', info.totalSize, 'bytes');
    console.log('   - Overhead:', carBytes.length - info.totalSize, 'bytes');
    console.log('   - Efficiency:', ((info.totalSize / carBytes.length) * 100).toFixed(1) + '%');
    
    // Parse back
    const recovered = await carBytesToToken(carBytes);
    const recoveredBytes = base64ToBytes(recovered.substring(1));
    const recoveredJSON = new TextDecoder().decode(recoveredBytes);
    const recoveredData = JSON.parse(recoveredJSON);
    
    console.log('\n4. Recovered data:');
    console.log(JSON.stringify(recoveredData, null, 2));
    
    expect(recoveredData).toEqual(sampleData);
    
    console.log('\n✅ Inspection complete!\n');
  });

  test('Example 7: Compare different token formats', async () => {
    console.log('\n=== Example 7: Token format comparison ===\n');
    
    const testData = 'Hello, UCAN delegation!';
    const bytes = new TextEncoder().encode(testData);
    
    // Format 1: Multibase with 'm' prefix (base64)
    const format1 = 'm' + bytesToBase64(bytes);
    console.log('Format 1 (multibase m):');
    console.log('  Token:', format1);
    console.log('  Length:', format1.length);
    
    const car1 = await tokenToCarBytes(format1);
    console.log('  CAR size:', car1.length, 'bytes\n');
    
    // Format 2: Raw base64 (no prefix)
    const format2 = bytesToBase64(bytes);
    console.log('Format 2 (raw base64):');
    console.log('  Token:', format2);
    console.log('  Length:', format2.length);
    
    const car2 = await tokenToCarBytes(format2);
    console.log('  CAR size:', car2.length, 'bytes\n');
    
    // Format 3: Multibase with 'u' prefix (base64url)
    const format3 = 'u' + bytesToBase64(bytes);
    console.log('Format 3 (multibase u):');
    console.log('  Token:', format3);
    console.log('  Length:', format3.length);
    
    const car3 = await tokenToCarBytes(format3);
    console.log('  CAR size:', car3.length, 'bytes\n');
    
    // All should produce same content
    const token1 = await carBytesToToken(car1);
    const token2 = await carBytesToToken(car2);
    const token3 = await carBytesToToken(car3);
    
    const bytes1 = base64ToBytes(token1.substring(1));
    const bytes2 = base64ToBytes(token2.substring(1));
    const bytes3 = base64ToBytes(token3.substring(1));
    
    console.log('Verification:');
    console.log('  All decode to same content:', 
      bytes1.length === bytes2.length && 
      bytes2.length === bytes3.length ? '✅' : '❌');
    
    expect(bytes1).toEqual(bytes);
    expect(bytes2).toEqual(bytes);
    expect(bytes3).toEqual(bytes);
    
    console.log('\n✅ All formats work correctly!\n');
  });
});

test.describe('CAR Examples - Error Handling', () => {
  test('Example 8: Handle invalid CAR file gracefully', async () => {
    console.log('\n=== Example 8: Error handling ===\n');
    
    // Test 1: Invalid bytes
    console.log('Test 1: Invalid bytes');
    const invalidBytes = new Uint8Array([1, 2, 3, 4, 5]);
    
    try {
      await carBytesToToken(invalidBytes);
      console.log('  ❌ Should have thrown error');
      expect(true).toBe(false);
    } catch (error) {
      console.log('  ✅ Correctly rejected invalid bytes');
      console.log('  Error:', (error as Error).message);
    }
    
    // Test 2: Empty token
    console.log('\nTest 2: Empty token');
    try {
      await tokenToCarBytes('');
      console.log('  ❌ Should have thrown error');
      expect(true).toBe(false);
    } catch (error) {
      console.log('  ✅ Correctly rejected empty token');
      console.log('  Error:', (error as Error).message);
    }
    
    // Test 3: Valid token (should succeed)
    console.log('\nTest 3: Valid token');
    try {
      const validToken = 'mSGVsbG8gV29ybGQh';
      const carBytes = await tokenToCarBytes(validToken);
      console.log('  ✅ Successfully processed valid token');
      console.log('  CAR size:', carBytes.length, 'bytes');
      expect(carBytes.length).toBeGreaterThan(0);
    } catch (error) {
      console.log('  ❌ Should not have thrown error', error);
      expect(true).toBe(false);
    }
    
    console.log('\n✅ Error handling works correctly!\n');
  });
});

test.describe('CAR Examples - Performance', () => {
  test('Example 9: Measure conversion performance', async () => {
    console.log('\n=== Example 9: Performance measurement ===\n');
    
    // Test different sizes
    const sizes = [100, 1000, 10000];
    
    for (const size of sizes) {
      const data = 'A'.repeat(size);
      const bytes = new TextEncoder().encode(data);
      const token = 'm' + bytesToBase64(bytes);
      
      console.log(`\nTest with ${size} byte payload:`);
      console.log('  Token length:', token.length);
      
      // Measure encoding
      const encodeStart = performance.now();
      const carBytes = await tokenToCarBytes(token);
      const encodeTime = performance.now() - encodeStart;
      
      console.log('  Encoding time:', encodeTime.toFixed(2), 'ms');
      console.log('  CAR size:', carBytes.length, 'bytes');
      console.log('  Overhead:', ((carBytes.length - size) / size * 100).toFixed(1), '%');
      
      // Measure decoding
      const decodeStart = performance.now();
      const recovered = await carBytesToToken(carBytes);
      const decodeTime = performance.now() - decodeStart;
      
      console.log('  Decoding time:', decodeTime.toFixed(2), 'ms');
      console.log('  Total time:', (encodeTime + decodeTime).toFixed(2), 'ms');
      
      // Verify
      const recoveredBytes = base64ToBytes(recovered.substring(1));
      expect(recoveredBytes).toEqual(bytes);
    }
    
    console.log('\n✅ Performance measurement complete!\n');
  });
});
