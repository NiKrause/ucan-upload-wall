# Varsig Branch Notes

This branch adds WebAuthn Ed25519 hardware signing via ChainAgnostic varsig
encoding and fallbacks to P-256 or worker-based Ed25519 when hardware Ed25519
is not available.

## What Changed

- Hardware-backed Ed25519 signer (varsig-encoded WebAuthn signatures).
- P-256 fallback path when Ed25519 is unsupported.
- Worker fallback path for forced or unsupported hardware mode.
- E2E coverage for hardware/worker modes and full delegation workflow.

## Local UCAN / Upload-API Wiring

- The browser uses le-space ucanto via tarball overrides in `web/package.json`.
- Upload-api tests use a varsig-aware principal in
  `web/tests/delegation-upload-flow.spec.ts` to avoid 64-byte Ed25519 checks.
- Varsig discriminants are WebAuthn-specific (`0xd1ed` for Ed25519,
  `0xd1f2` for P-256 pending registration).

## Tests

- `web/tests/hardware-mode.spec.ts`
- `web/tests/delegation-upload-flow.spec.ts`

## Follow-ups

- Upstream varsig verification into ucanto validator/server.
- Remove local tarball overrides once upstream packages are released.
