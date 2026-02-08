# WebAuthn Varsig + OrbitDB Identity Demo (Browser-Only)

This branch adds a browser-only React demo that shows how to build an OrbitDB-style
identity using WebAuthn varsig without creating a separate browser keystore keypair,
then uses that identity with a real OrbitDB events database in the browser.

## What this demo does

- Registers a passkey (Ed25519 preferred, P-256 fallback).
- Encodes WebAuthn assertions into varsig v1 envelopes.
- Creates an "OrbitDB-style" identity with:
  - `id` derived from the DID key (DIDKey from the WebAuthn public key).
  - `signatures.id` = varsig over the DID payload.
  - `signatures.publicKey` = varsig over `publicKey || signatures.id`.
- Starts a real OrbitDB events database and adds entries signed by WebAuthn.
- Signs arbitrary "record" payloads with WebAuthn varsig and verifies them in-browser.

## What this demo does NOT do

- It does not use OrbitDB's default keystore-based identity flow.
- It does not run server-side verification or WebAuthn attestation checks.
- It does not persist to a remote storage backend (replication is peer-to-peer).

## Files added/updated

- `iso-repo/examples/webauthn-varsig-orbitdb`: new example, copied from
  `iso-repo/examples/webauthn-varsig` and extended with OrbitDB-style identity
  creation and record signing using WebAuthn varsig.

## Run it

```sh
cd iso-repo/examples/webauthn-varsig-orbitdb
pnpm install
pnpm dev
```

Requires a secure context (https or localhost) for WebAuthn.
