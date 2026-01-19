# Varsig v1 WebAuthn Implementation

This document describes our varsig v1 WebAuthn wrapper: the byte layout,
locked parameters, verification policy, and code paths that implement it.

References:
- https://github.com/ChainAgnostic/varsig/blob/main/README.md
- https://github.com/ChainAgnostic/varsig#signature-algorithm

## Status

We emit and verify a strict varsig v1 header (`0x34 0x01`) with signature
metadata that follows the spec table ordering. Legacy formats are rejected.

## Wire Format (Varsig v1 + WebAuthn Extension)

Header:
1) `0x34` varsig prefix
2) `0x01` varsig version

Signature‑algorithm metadata (unsigned varint segments):
1) `0xED` (EdDSA) or `0xEC` (ECDSA) discriminant
2) curve varint (Ed25519 or P‑256)
3) multihash header varints (SHA‑256 code + digest length)
4) WebAuthn wrapper marker (`0x300001`, private‑use multicodec range)

Payload‑encoding metadata:
5) `0x5f` (byte‑identical payload)

Signature bytes:
- WebAuthn assertion serialization:
  - varint(authenticatorData.length)
  - authenticatorData
  - varint(clientDataJSON.length)
  - clientDataJSON
  - signature (remaining bytes)

## Locked Parameters

Signature algorithm discriminants:
- EdDSA: `0xED`
- ECDSA: `0xEC`

Curve varints (multicodec):
- Ed25519: `0xED01`
- P‑256 (secp256r1): `0x1200`

Multihash header (hash function + digest length):
- SHA‑256: `0x12 0x20`

WebAuthn wrapper marker:
- `0x300001` (private‑use multicodec range)

Payload encoding:
- `0x5f` (byte‑identical)

Versioning:
- Reject any non‑v1 varsig header.

Challenge derivation:
- challenge = SHA‑256("ucan‑webauthn‑v1:" || sigPayloadBytes)
- sigPayloadBytes = canonical UCAN SigPayload bytes (DAG‑CBOR, no signature)
- clientDataJSON.challenge = base64url(challenge)

WebAuthn verification policy:
- Require origin match.
- Require rpIdHash match.
- Require UP flag; UV not required.
- Enforce monotonic signCount.

## Implementation Map

Core varsig module:
- `web/src/lib/webauthn-varsig/encoder.ts`
- `web/src/lib/webauthn-varsig/decoder.ts`
- `web/src/lib/webauthn-varsig/verifier.ts`
- `web/src/lib/webauthn-varsig/multicodec.ts`
- `web/src/lib/webauthn-varsig/types.ts`
- `web/src/lib/webauthn-varsig/utils.ts`

WebAuthn signers:
- `web/src/lib/webauthn-ed25519-signer.ts`

UCAN integration:
- `web/src/lib/hardware-ucan-service.ts`
- `web/src/lib/ucan-delegation.ts`

Tests and notes:
- `web/src/lib/webauthn-varsig/index.test.ts`
- `docs/varsig-branch-notes.md`

## Verification Flow (Summary)

1) Decode varsig v1 header + metadata.
2) Validate wrapper marker + payload encoding.
3) Parse clientDataJSON and check origin/rpIdHash/flags/signCount.
4) Reconstruct signed bytes: `authenticatorData || SHA-256(clientDataJSON)`.
5) Verify signature using Ed25519 or P‑256 based on metadata.
