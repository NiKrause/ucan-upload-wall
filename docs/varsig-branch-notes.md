# Varsig Branch Notes

This branch adds WebAuthn Ed25519 hardware signing via varsig v1 with a
worker-based Ed25519 fallback when hardware Ed25519 is not available.

## What Changed

- Hardware-backed Ed25519 signer (varsig v1 WebAuthn signatures).
- Worker fallback path for forced or unsupported hardware mode.
- E2E coverage for hardware/worker modes and full delegation workflow.

## Local UCAN / Upload-API Wiring

- The browser uses le-space ucanto via tarball overrides in `web/package.json`.
- Upload-api tests use a varsig-aware principal in
  `web/tests/delegation-upload-flow.spec.ts` to avoid 64-byte Ed25519 checks.
- Varsig v1 header is enforced (`0x34 0x01`) with Ed25519 metadata only.
  Hardware P-256 is not supported yet.

## Tests

- `web/tests/hardware-mode.spec.ts`
- `web/tests/delegation-upload-flow.spec.ts`

## Follow-ups

- Upstream varsig verification into ucanto validator/server.
- Remove local tarball overrides once upstream packages are released.
