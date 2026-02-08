import { describe, expect, it } from 'vitest'
import {
  CURVE_ED25519,
  CURVE_P256,
  INNER_EDDSA,
  INNER_ECDSA,
  MULTIHASH_SHA256,
  MULTIHASH_SHA256_LEN,
  PAYLOAD_ENCODING_RAW,
  VARSIG_PREFIX,
  VARSIG_VERSION,
  WEBAUTHN_WRAPPER,
  decodeWebAuthnVarsigV1,
  encodeWebAuthnVarsigV1,
} from 'iso-webauthn-varsig'

function createMockAuthenticatorData(): Uint8Array {
  const data = new Uint8Array(37)
  data[32] = 0x01 | 0x04
  data[36] = 1
  return data
}

function createMockClientDataJSON(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: 'demo',
      origin: 'https://example.com',
      crossOrigin: false,
    })
  )
}

function createMockEd25519Signature(): Uint8Array {
  const signature = new Uint8Array(64)
  signature[0] = 1
  signature[63] = 2
  return signature
}

function createMockP256Signature(): Uint8Array {
  const r = new Uint8Array(32)
  const s = new Uint8Array(32)
  r[0] = 1
  s[0] = 2

  const signature = new Uint8Array(6 + 32 + 32)
  signature[0] = 0x30
  signature[1] = 68
  signature[2] = 0x02
  signature[3] = 32
  signature.set(r, 4)
  signature[36] = 0x02
  signature[37] = 32
  signature.set(s, 38)

  return signature
}

describe('iso-webauthn-varsig integration', () => {
  it('encodes and decodes Ed25519 varsig v1', () => {
    const varsig = encodeWebAuthnVarsigV1(
      {
        authenticatorData: createMockAuthenticatorData(),
        clientDataJSON: createMockClientDataJSON(),
        signature: createMockEd25519Signature(),
      },
      'Ed25519'
    )

    const decoded = decodeWebAuthnVarsigV1(varsig)

    expect(varsig[0]).toBe(VARSIG_PREFIX)
    expect(varsig[1]).toBe(VARSIG_VERSION)
    expect(decoded.innerAlgorithm).toBe(INNER_EDDSA)
    expect(decoded.curve).toBe(CURVE_ED25519)
    expect(decoded.multihashCode).toBe(MULTIHASH_SHA256)
    expect(decoded.multihashLength).toBe(MULTIHASH_SHA256_LEN)
    expect(decoded.webauthnMarker).toBe(WEBAUTHN_WRAPPER)
    expect(decoded.payloadEncoding).toBe(PAYLOAD_ENCODING_RAW)
  })

  it('encodes and decodes P-256 varsig v1', () => {
    const varsig = encodeWebAuthnVarsigV1(
      {
        authenticatorData: createMockAuthenticatorData(),
        clientDataJSON: createMockClientDataJSON(),
        signature: createMockP256Signature(),
      },
      'P-256'
    )

    const decoded = decodeWebAuthnVarsigV1(varsig)

    expect(decoded.innerAlgorithm).toBe(INNER_ECDSA)
    expect(decoded.curve).toBe(CURVE_P256)
    expect(decoded.algorithm).toBe('P-256')
  })
})
