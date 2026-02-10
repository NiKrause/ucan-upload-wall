/**
 * Tests for CAR (Content Addressable aRchive) utilities
 * 
 * These tests verify:
 * 1. Converting delegation tokens to CAR files
 * 2. Parsing CAR files back to tokens
 * 3. Round-trip conversion (token -> CAR -> token)
 * 4. Handling different token formats (multibase, base64)
 * 5. CAR file validation and information extraction
 */

import { test, expect } from '@playwright/test';
import {
  base64ToBytes,
  bytesToBase64,
  tokenToCarBytes,
  carBytesToToken,
  createCarFile,
  parseCarFile,
  isValidCarFile,
  getCarFileInfo
} from '../../src/lib/car-utils';

test.describe('CAR Utils - Base64 Conversion', () => {
  test('should convert base64 to bytes', () => {
    const base64 = 'SGVsbG8gV29ybGQh'; // "Hello World!"
    const bytes = base64ToBytes(base64);
    
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(12);
    
    // Verify content
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('Hello World!');
  });

  test('should convert bytes to base64', () => {
    const text = 'Hello World!';
    const bytes = new TextEncoder().encode(text);
    const base64 = bytesToBase64(bytes);
    
    expect(base64).toBe('SGVsbG8gV29ybGQh');
  });

  test('should handle round-trip conversion', () => {
    const original = 'SGVsbG8gV29ybGQh';
    const bytes = base64ToBytes(original);
    const result = bytesToBase64(bytes);
    
    expect(result).toBe(original);
  });

  test('should handle URL-safe base64', () => {
    // URL-safe base64 uses - instead of + and _ instead of /
    const urlSafe = 'SGVsbG8tV29ybGRf'; // Modified to include - and _
    const bytes = base64ToBytes(urlSafe);
    
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  test('should handle base64 with whitespace', () => {
    const withSpaces = 'SGVs bG8g V29y bGQh';
    const bytes = base64ToBytes(withSpaces);
    
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('Hello World!');
  });
});

test.describe('CAR Utils - Token to CAR Conversion', () => {
  test('should convert token to CAR bytes', async () => {
    // Sample delegation token (base64 encoded data)
    const token = 'SGVsbG8gV29ybGQh';
    
    const carBytes = await tokenToCarBytes(token);
    
    expect(carBytes).toBeInstanceOf(Uint8Array);
    expect(carBytes.length).toBeGreaterThan(0);
    
    // CAR files have a specific header format
    // The first few bytes should indicate it's a CAR file
    expect(carBytes.length).toBeGreaterThan(20); // Minimum CAR file size
  });

  test('should handle multibase format with m prefix', async () => {
    const token = 'mSGVsbG8gV29ybGQh'; // 'm' prefix for multibase base64
    
    const carBytes = await tokenToCarBytes(token);
    
    expect(carBytes).toBeInstanceOf(Uint8Array);
    expect(carBytes.length).toBeGreaterThan(0);
  });

  test('should handle multibase format with u prefix', async () => {
    const token = 'uSGVsbG8gV29ybGQh'; // 'u' prefix for multibase base64url
    
    const carBytes = await tokenToCarBytes(token);
    
    expect(carBytes).toBeInstanceOf(Uint8Array);
    expect(carBytes.length).toBeGreaterThan(0);
  });

  test('should create valid CAR file structure', async () => {
    const token = 'SGVsbG8gV29ybGQh';
    
    const carBytes = await tokenToCarBytes(token);
    
    // Verify it's a valid CAR file
    const isValid = await isValidCarFile(carBytes);
    expect(isValid).toBe(true);
  });

  test('should handle large tokens', async () => {
    // Create a larger token (simulate real delegation)
    const largeData = 'A'.repeat(1000);
    const token = bytesToBase64(new TextEncoder().encode(largeData));
    
    const carBytes = await tokenToCarBytes(token);
    
    expect(carBytes).toBeInstanceOf(Uint8Array);
    expect(carBytes.length).toBeGreaterThan(1000);
  });
});

test.describe('CAR Utils - CAR to Token Conversion', () => {
  test('should parse CAR bytes back to token', async () => {
    const originalToken = 'SGVsbG8gV29ybGQh';
    
    // Convert to CAR
    const carBytes = await tokenToCarBytes(originalToken);
    
    // Parse back to token
    const parsedToken = await carBytesToToken(carBytes);
    
    // Should have 'm' prefix added
    expect(parsedToken).toMatch(/^m/);
    expect(parsedToken.length).toBeGreaterThan(originalToken.length);
  });

  test('should handle round-trip conversion', async () => {
    const originalToken = 'mOqJlcm9vdHOB2CpYJQABcRIgdu3EV9zKV82sp0eAvnhMU/a50hAb7JK48h0tnCMbOQ5ndmVyc2lvbgGgBwFxEiBAbSOyqcGFns+pSUICF9F385WeykGT4Ne4ipernurTrKdhc1hE7aEDQC+R2FzkCoUcxKFUJzvwBm2Wczj0hrBjVlxwmYqdD/BHgPcXKn/iw2+wlrpeFsFtxjQJ7M02DhazOtAzvCoZqAFhdmUwLjkuMWNhdHSJo2JuYqBjY2FuaGFzc2VydC8qZHdpdGh4OGRpZDprZXk6ejZNa2hiY05ZTjVKZEpnOTdyRkYyNnlnbkRONHNnRHo4eWQ5dlNLWVZzaFQzNVRVo2JuYqBjY2FuZ3NwYWNlLypkd2l0aHg4ZGlkOmtleTp6Nk1raGJjTllONUpkSmc5N3JGRjI2eWduRE40c2dEejh5ZDl2U0tZVnNoVDM1VFWjYm5ioGNjYW5mYmxvYi8qZHdpdGh4OGRpZDprZXk6ejZNa2hiY05ZTjVKZEpnOTdyRkYyNnlnbkRONHNnRHo4eWQ5dlNLWVZzaFQzNVRVo2JuYqBjY2FuZ2luZGV4Lypkd2l0aHg4ZGlkOmtleTp6Nk1raGJjTllONUpkSmc5N3JGRjI2eWduRE40c2dEejh5ZDl2U0tZVnNoVDM1VFWjYm5ioGNjYW5nc3RvcmUvKmR3aXRoeDhkaWQ6a2V5Ono2TWtoYmNOWU41SmRKZzk3ckZGMjZ5Z25ETjRzZ0R6OHlkOXZTS1lWc2hUMzVUVaNibmKgY2Nhbmh1cGxvYWQvKmR3aXRoeDhkaWQ6a2V5Ono2TWtoYmNOWU41SmRKZzk3ckZGMjZ5Z25ETjRzZ0R6OHlkOXZTS1lWc2hUMzVUVaNibmKgY2NhbmhhY2Nlc3MvKmR3aXRoeDhkaWQ6a2V5Ono2TWtoYmNOWU41SmRKZzk3ckZGMjZ5Z25ETjRzZ0R6OHlkOXZTS1lWc2hUMzVUVaNibmKgY2NhbmpmaWxlY29pbi8qZHdpdGh4OGRpZDprZXk6ejZNa2hiY05ZTjVKZEpnOTdyRkYyNnlnbkRONHNnRHo4eWQ5dlNLWVZzaFQzNVRVo2JuYqBjY2FuZ3VzYWdlLypkd2l0aHg4ZGlkOmtleTp6Nk1raGJjTllONUpkSmc5N3JGRjI2eWduRE40c2dEejh5ZDl2U0tZVnNoVDM1VFVjYXVkWBmdGm1haWx0bzpnbWFpbC5jb206YXNhYnlhY2V4cPZjaXNzWCLtAS62sNWBurscA8JBwqQV3mQnLLPwxQIrpYPRMOfo7iD/Y3ByZoC7AgFxEiAoT5nXaFgV51LKCoC9G5T9B0x1/BnbfO+WfpIbg+bfEKhhc1hE7aEDQLm2VMKyzPojRG8c0fpf0socW2RLolJX7PRoZC6IK1AzbbBGLTJS6yW28KHA73ujWgQzwUTiNVnLgo9+f+ZOWQ5hdmUwLjkuMWNhdHSBomNjYW5hKmR3aXRoeDhkaWQ6a2V5Ono2TWtqS0FIMkFBQ3dacmU2YldpdWY0amlFejhVQ2ptN0IxWlVROVBlaGNUdVJIcGNhdWRYGZ0abWFpbHRvOmdtYWlsLmNvbTphc2FieWFjZXhw9mNmY3SBoWVzcGFjZaJkbmFtZWNsZmdmYWNjZXNzoWR0eXBlZnB1YmxpY2Npc3NYIu0BSDdEB9YRbyDsT1AyhvYqSFfWGLFm7et9zQp64drOsE9jcHJmgKAHAXESIJRb/A+zv4UFO+NfabxnShzpBMK2SRxIFZjNlhb+gt5yp2FzWETtoQNAgk/oYe7eOFen8+D/1cb3xBW3xz4mo67M7y0to4AyDdonUQ2NP1rWw5eIWyhYH+kn20rMALVKtVRwRir5ObkvCWF2ZTAuOS4xY2F0dImjYm5ioGNjYW5oYXNzZXJ0Lypkd2l0aHg4ZGlkOmtleTp6Nk1rcml4NEo0RG1xZGFRWjdVZUNvS1pYalF5WFhucVNGZVNDTnhQdDd4c2VaSkijYm5ioGNjYW5nc3BhY2UvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyaXg0SjREbXFkYVFaN1VlQ29LWlhqUXlYWG5xU0ZlU0NOeFB0N3hzZVpKSKNibmKgY2NhbmZibG9iLypkd2l0aHg4ZGlkOmtleTp6Nk1rcml4NEo0RG1xZGFRWjdVZUNvS1pYalF5WFhucVNGZVNDTnhQdDd4c2VaSkijYm5ioGNjYW5naW5kZXgvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyaXg0SjREbXFkYVFaN1VlQ29LWlhqUXlYWG5xU0ZlU0NOeFB0N3hzZVpKSKNibmKgY2NhbmdzdG9yZS8qZHdpdGh4OGRpZDprZXk6ejZNa3JpeDRKNERtcWRhUVo3VWVDb0taWGpReVhYbnFTRmVTQ054UHQ3eHNlWkpIo2JuYqBjY2FuaHVwbG9hZC8qZHdpdGh4OGRpZDprZXk6ejZNa3JpeDRKNERtcWRhUVo3VWVDb0taWGpReVhYbnFTRmVTQ054UHQ3eHNlWkpIo2JuYqBjY2FuaGFjY2Vzcy8qZHdpdGh4OGRpZDprZXk6ejZNa3JpeDRKNERtcWRhUVo3VWVDb0taWGpReVhYbnFTRmVTQ054UHQ3eHNlWkpIo2JuYqBjY2FuamZpbGVjb2luLypkd2l0aHg4ZGlkOmtleTp6Nk1rcml4NEo0RG1xZGFRWjdVZUNvS1pYalF5WFhucVNGZVNDTnhQdDd4c2VaSkijYm5ioGNjYW5ndXNhZ2UvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyaXg0SjREbXFkYVFaN1VlQ29LWlhqUXlYWG5xU0ZlU0NOeFB0N3hzZVpKSGNhdWRYGZ0abWFpbHRvOmdtYWlsLmNvbTphc2FieWFjZXhw9mNpc3NYIu0BtlEydgfJaJr2bNQHsfkonAHhg4cP3sKO1m2DaY2w57JjcHJmgLwCAXESIGSVsOmbkzfqIfefu8gdfIR15oQD8KEiBu+MT8zHIDeZqGFzWETtoQNA0IWCksv16r9Cy80kBAzeiu+P9FDWd69UPESJcOTYmraW6fBL6SYzC9nONazutklc5DvEpdeT5dnLVKSnuMdhDmF2ZTAuOS4xY2F0dIGiY2NhbmEqZHdpdGh4OGRpZDprZXk6ejZNa2czU1BpRnF6YVd2V1pUa2Z1VmZZaVM2ZUN6U1FkajhNMkQycnc2QlRTUzFFY2F1ZFgZnRptYWlsdG86Z21haWwuY29tOmFzYWJ5YWNleHD2Y2ZjdIGhZXNwYWNlomRuYW1lZGxmZzJmYWNjZXNzoWR0eXBlZnB1YmxpY2Npc3NYIu0BF50iO823I6ps0d5WnHHrkgpkXSg6xStv6yo/NJROW5ljcHJmgLcDAXESICH/g7ocRz52pZdkEzpkqHLB/iXqUcVhRXeIHcNjAp9jqGFzRICgAwBhdmUwLjkuMWNhdHSBomNjYW5hKmR3aXRoZnVjYW46KmNhdWRYIu0B9yUEMnU9RvciDt3x/eQ9E9t4DYsNwSK2NtpZy6bNp2JjZXhw9mNmY3SBom5hY2Nlc3MvY29uZmlybdgqWCUAAXESIJbFbp7xqXCs8LzV3UELSGlP9ip5+D46yAmNqg6RpB9tbmFjY2Vzcy9yZXF1ZXN02CpYJQABcRIg+xpPnGeKChDYv/nX5DsypHTafJZcDLmEszvV6WjNdEtjaXNzWBmdGm1haWx0bzpnbWFpbC5jb206YXNhYnlhY3ByZoTYKlglAAFxEiBAbSOyqcGFns+pSUICF9F385WeykGT4Ne4ipernurTrNgqWCUAAXESIChPmddoWBXnUsoKgL0blP0HTHX8Gdt875Z+khuD5t8Q2CpYJQABcRIglFv8D7O/hQU7419pvGdKHOkEwrZJHEgVmM2WFv6C3nLYKlglAAFxEiBklbDpm5M36iH3n7vIHXyEdeaEA/ChIgbvjE/MxyA3macDAXESIGmk9HWMM/7JOpJkflp0qqNdfVQ48/r3na1jESKlEPbEqGFzWETtoQNAQZYqImJo96hu/t+okJiQ5SKOIMTcMyizBxzDJb+7jMbzcfgwhzpfGzmfl2KbdWgMD/qOrvgqauLl8SA9aGw7DGF2ZTAuOS4xY2F0dIGjYm5ioWVwcm9vZtgqWCUAAXESICH/g7ocRz52pZdkEzpkqHLB/iXqUcVhRXeIHcNjAp9jY2Nhbmt1Y2FuL2F0dGVzdGR3aXRoeBtkaWQ6d2ViOnVwLnN0b3JhY2hhLm5ldHdvcmtjYXVkWCLtAfclBDJ1PUb3Ig7d8f3kPRPbeA2LDcEitjbaWcumzadiY2V4cPZjZmN0gaJuYWNjZXNzL2NvbmZpcm3YKlglAAFxEiCWxW6e8alwrPC81d1BC0hpT/Yqefg+OsgJjaoOkaQfbW5hY2Nlc3MvcmVxdWVzdNgqWCUAAXESIPsaT5xnigoQ2L/51+Q7MqR02nyWXAy5hLM71elozXRLY2lzc1gZnRp3ZWI6dXAuc3RvcmFjaGEubmV0d29ya2NwcmaAgQgBcRIgvg908+sqLVoHPMSUvo1YhYbfwBgmwxS0SFOaVwZMjLCoYXNYRO2hA0D0M8Vu8/j/L4NDZbC7NmfRXGq6pUl3d3GZaGKZLcaTn0wwpXDbbTHNmagO5VuKkq4BUdqhrzA2uPETCWQtyRsKYXZlMC45LjFjYXR0iaJjY2FuaGFzc2VydC8qZHdpdGh4OGRpZDprZXk6ejZNa2pLQUgyQUFDd1pyZTZiV2l1ZjRqaUV6OFVDam03QjFaVVE5UGVoY1R1UkhwomNjYW5nc3BhY2UvKmR3aXRoeDhkaWQ6a2V5Ono2TWtqS0FIMkFBQ3dacmU2YldpdWY0amlFejhVQ2ptN0IxWlVROVBlaGNUdVJIcKJjY2FuZmJsb2IvKmR3aXRoeDhkaWQ6a2V5Ono2TWtqS0FIMkFBQ3dacmU2YldpdWY0amlFejhVQ2ptN0IxWlVROVBlaGNUdVJIcKJjY2FuZ2luZGV4Lypkd2l0aHg4ZGlkOmtleTp6Nk1raktBSDJBQUN3WnJlNmJXaXVmNGppRXo4VUNqbTdCMVpVUTlQZWhjVHVSSHCiY2NhbmdzdG9yZS8qZHdpdGh4OGRpZDprZXk6ejZNa2pLQUgyQUFDd1pyZTZiV2l1ZjRqaUV6OFVDam03QjFaVVE5UGVoY1R1UkhwomNjYW5odXBsb2FkLypkd2l0aHg4ZGlkOmtleTp6Nk1raktBSDJBQUN3WnJlNmJXaXVmNGppRXo4VUNqbTdCMVpVUTlQZWhjVHVSSHCiY2NhbmhhY2Nlc3MvKmR3aXRoeDhkaWQ6a2V5Ono2TWtqS0FIMkFBQ3dacmU2YldpdWY0amlFejhVQ2ptN0IxWlVROVBlaGNUdVJIcKJjY2FuamZpbGVjb2luLypkd2l0aHg4ZGlkOmtleTp6Nk1raktBSDJBQUN3WnJlNmJXaXVmNGppRXo4VUNqbTdCMVpVUTlQZWhjVHVSSHCiY2Nhbmd1c2FnZS8qZHdpdGh4OGRpZDprZXk6ejZNa2pLQUgyQUFDd1pyZTZiV2l1ZjRqaUV6OFVDam03QjFaVVE5UGVoY1R1UkhwY2F1ZFgi7QFk5SOkxwUuMx7q65RAXJ7zF4fzVBYWBaMyYps4xi11C2NleHD2Y2ZjdIGhZXNwYWNlomRuYW1lY2xmZ2ZhY2Nlc3OhZHR5cGVmcHVibGljY2lzc1gi7QH3JQQydT1G9yIO3fH95D0T23gNiw3BIrY22lnLps2nYmNwcmaC2CpYJQABcRIgIf+DuhxHPnall2QTOmSocsH+JepRxWFFd4gdw2MCn2PYKlglAAFxEiBppPR1jDP+yTqSZH5adKqjXX1UOPP6952tYxEipRD2xKMDAXESIGsEGsDMmpD1SHMujHL4o/MIf7IA7lCsRTtZ97uRl5+Rp2FzWETtoQNAQw19FcW7GtAqJ3io4mr8J53gyVOMsjFf1ignGZsWADTPaKy/bBMkDcne68H+vxAwN655SkyC3jJwO5l1MWA7BmF2ZTAuOS4xY2F0dIKiY2Nhbm5zcGFjZS9ibG9iL2FkZGR3aXRoeDhkaWQ6a2V5Ono2TWtqS0FIMkFBQ3dacmU2YldpdWY0amlFejhVQ2ptN0IxWlVROVBlaGNUdVJIcKJjY2FuanVwbG9hZC9hZGRkd2l0aHg4ZGlkOmtleTp6Nk1raktBSDJBQUN3WnJlNmJXaXVmNGppRXo4VUNqbTdCMVpVUTlQZWhjVHVSSHBjYXVkWCLtAa1e01u2vjkV+dfrQuI9A4x+MbIZOf6LG595oh+gjTq1Y2V4cBpphYrAY2lzc1gi7QFk5SOkxwUuMx7q65RAXJ7zF4fzVBYWBaMyYps4xi11C2NwcmaB2CpYJQABcRIgvg908+sqLVoHPMSUvo1YhYbfwBgmwxS0SFOaVwZMjLBZAXESIHbtxFfcylfNrKdHgL54TFP2udIQG+ySuPIdLZwjGzkOoWp1Y2FuQDAuOS4x2CpYJQABcRIgawQawMyakPVIcy6Mcvij8wh/sgDuUKxFO1n3u5GXn5E=';
    
    // Convert to CAR
    const carBytes = await tokenToCarBytes(originalToken);
    
    // Parse back to token
    const parsedToken = await carBytesToToken(carBytes);
    
    // The content should match (both should decode to same bytes)
    const originalBytes = base64ToBytes(originalToken.substring(1));
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    
    expect(parsedBytes).toEqual(originalBytes);
  });

  test('should throw error for invalid CAR file', async () => {
    const invalidBytes = new Uint8Array([1, 2, 3, 4, 5]);
    
    await expect(carBytesToToken(invalidBytes)).rejects.toThrow();
  });

  test('should throw error for CAR file with no roots', async () => {
    // This is a theoretical test - in practice, CAR files should always have roots
    // But we test the error handling
    const invalidBytes = new Uint8Array([0, 0, 0, 0]);
    
    await expect(carBytesToToken(invalidBytes)).rejects.toThrow();
  });
});

test.describe('CAR Utils - File Operations', () => {
  test('should create CAR file from token', async () => {
    const token = 'mSGVsbG8gV29ybGQh';
    const targetDID = 'did:key:z6Mktest123';
    
    const file = await createCarFile(token, targetDID);
    
    expect(file).toBeInstanceOf(File);
    expect(file.name).toMatch(/^did:key:z6Mktest123-\d+\.car$/);
    expect(file.type).toBe('application/vnd.ipld.car');
    expect(file.size).toBeGreaterThan(0);
  });

  test('should create file with correct timestamp', async () => {
    const token = 'mSGVsbG8gV29ybGQh';
    const targetDID = 'did:key:z6Mktest123';
    
    const beforeTimestamp = Math.floor(Date.now() / 1000);
    const file = await createCarFile(token, targetDID);
    const afterTimestamp = Math.floor(Date.now() / 1000);
    
    // Extract timestamp from filename
    const match = file.name.match(/-(\d+)\.car$/);
    expect(match).toBeTruthy();
    
    const fileTimestamp = parseInt(match![1]);
    expect(fileTimestamp).toBeGreaterThanOrEqual(beforeTimestamp);
    expect(fileTimestamp).toBeLessThanOrEqual(afterTimestamp);
  });

  test('should parse CAR file back to token', async () => {
    const originalToken = 'mSGVsbG8gV29ybGQh';
    const targetDID = 'did:key:z6Mktest123';
    
    // Create file
    const file = await createCarFile(originalToken, targetDID);
    
    // Parse file
    const parsedToken = await parseCarFile(file);
    
    // Should match (both decode to same bytes)
    const originalBytes = base64ToBytes(originalToken.substring(1));
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    
    expect(parsedBytes).toEqual(originalBytes);
  });

  test('should handle file round-trip conversion', async () => {
    const originalToken = 'mSGVsbG8gV29ybGQh';
    const targetDID = 'did:key:z6Mktest123';
    
    // Create file
    const file = await createCarFile(originalToken, targetDID);
    
    // Parse file
    const parsedToken = await parseCarFile(file);
    
    // Convert back to file
    const file2 = await createCarFile(parsedToken, targetDID);
    
    // Files should have same size (content is identical)
    expect(file2.size).toBe(file.size);
  });
});

test.describe('CAR Utils - Validation', () => {
  test('should validate valid CAR file', async () => {
    const token = 'SGVsbG8gV29ybGQh';
    const carBytes = await tokenToCarBytes(token);
    
    const isValid = await isValidCarFile(carBytes);
    
    expect(isValid).toBe(true);
  });

  test('should reject invalid CAR file', async () => {
    const invalidBytes = new Uint8Array([1, 2, 3, 4, 5]);
    
    const isValid = await isValidCarFile(invalidBytes);
    
    expect(isValid).toBe(false);
  });

  test('should reject empty bytes', async () => {
    const emptyBytes = new Uint8Array(0);
    
    const isValid = await isValidCarFile(emptyBytes);
    
    expect(isValid).toBe(false);
  });
});

test.describe('CAR Utils - Information Extraction', () => {
  test('should get CAR file information', async () => {
    const token = 'SGVsbG8gV29ybGQh';
    const carBytes = await tokenToCarBytes(token);
    
    const info = await getCarFileInfo(carBytes);
    
    expect(info).toHaveProperty('roots');
    expect(info).toHaveProperty('blockCount');
    expect(info).toHaveProperty('totalSize');
    
    expect(info.roots).toBeInstanceOf(Array);
    expect(info.roots.length).toBe(1);
    expect(info.blockCount).toBe(1);
    expect(info.totalSize).toBeGreaterThan(0);
  });

  test('should return valid CID in roots', async () => {
    const token = 'SGVsbG8gV29ybGQh';
    const carBytes = await tokenToCarBytes(token);
    
    const info = await getCarFileInfo(carBytes);
    
    // CID should start with 'b' (base32) or 'Qm' (base58 for v0)
    const rootCID = info.roots[0];
    expect(rootCID).toMatch(/^(b[a-z2-7]|Qm)/);
  });

  test('should calculate correct total size', async () => {
    const token = 'SGVsbG8gV29ybGQh';
    const carBytes = await tokenToCarBytes(token);
    
    const info = await getCarFileInfo(carBytes);
    
    // Total size should match the decoded token size
    const decodedBytes = base64ToBytes(token);
    expect(info.totalSize).toBe(decodedBytes.length);
  });
});

test.describe('CAR Utils - Real-world Scenarios', () => {
  test('should handle realistic UCAN delegation token', async () => {
    // Simulate a realistic UCAN token (longer, more complex)
    const mockUcanData = JSON.stringify({
      v: '0.9.0',
      iss: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      aud: 'did:key:z6MkrZ1r5XBFZjBU34qyD8fueMbMRkKw17BZaq2ivKFjnz2z',
      att: [{ can: 'space/blob/add' }],
      exp: 1234567890,
      prf: []
    });
    
    const token = 'm' + bytesToBase64(new TextEncoder().encode(mockUcanData));
    
    // Convert to CAR
    const carBytes = await tokenToCarBytes(token);
    expect(carBytes.length).toBeGreaterThan(100);
    
    // Validate
    const isValid = await isValidCarFile(carBytes);
    expect(isValid).toBe(true);
    
    // Parse back
    const parsedToken = await carBytesToToken(carBytes);
    
    // Verify content matches
    const originalBytes = base64ToBytes(token.substring(1));
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    expect(parsedBytes).toEqual(originalBytes);
  });

  test('should handle delegation with special characters', async () => {
    const specialData = 'Test with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
    const token = 'm' + bytesToBase64(new TextEncoder().encode(specialData));
    
    const carBytes = await tokenToCarBytes(token);
    const parsedToken = await carBytesToToken(carBytes);
    
    // Decode and verify
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    const parsedText = new TextDecoder().decode(parsedBytes);
    
    expect(parsedText).toBe(specialData);
  });

  test('should handle multiple sequential conversions', async () => {
    const token = 'mSGVsbG8gV29ybGQh';
    
    // Convert multiple times
    const carBytes1 = await tokenToCarBytes(token);
    const parsedToken1 = await carBytesToToken(carBytes1);
    
    const carBytes2 = await tokenToCarBytes(parsedToken1);
    const parsedToken2 = await carBytesToToken(carBytes2);
    
    const carBytes3 = await tokenToCarBytes(parsedToken2);
    const parsedToken3 = await carBytesToToken(carBytes3);
    
    // All should produce same content
    const originalBytes = base64ToBytes(token.substring(1));
    const parsed1Bytes = base64ToBytes(parsedToken1.substring(1));
    const parsed2Bytes = base64ToBytes(parsedToken2.substring(1));
    const parsed3Bytes = base64ToBytes(parsedToken3.substring(1));
    
    expect(parsed1Bytes).toEqual(originalBytes);
    expect(parsed2Bytes).toEqual(originalBytes);
    expect(parsed3Bytes).toEqual(originalBytes);
  });
});

test.describe('CAR Utils - Edge Cases', () => {
  test('should handle very long token', async () => {
    // Create a 10KB token
    const largeData = 'A'.repeat(10000);
    const token = 'm' + bytesToBase64(new TextEncoder().encode(largeData));
    
    const carBytes = await tokenToCarBytes(token);
    expect(carBytes.length).toBeGreaterThan(10000);
    
    // Should still be valid
    const isValid = await isValidCarFile(carBytes);
    expect(isValid).toBe(true);
  });

  test('should handle binary data in token', async () => {
    // Create binary data
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      binaryData[i] = i;
    }
    
    const token = 'm' + bytesToBase64(binaryData);
    
    const carBytes = await tokenToCarBytes(token);
    const parsedToken = await carBytesToToken(carBytes);
    
    // Verify binary data is preserved
    const parsedBytes = base64ToBytes(parsedToken.substring(1));
    expect(parsedBytes).toEqual(binaryData);
  });
});
