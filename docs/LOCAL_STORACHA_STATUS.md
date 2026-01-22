# Local Storacha + Helia Status

This project now supports a local in-memory Storacha upload API and a local Helia
node to enable browser previews via IPFS. This document summarizes current
behavior, configuration, and known pain points.

## Current Behavior

- `npm run storacha:memory` starts:
  - In-memory upload-api (HTTP on `127.0.0.1:8787`).
  - Local Helia node with a WebSocket listen address.
  - Logs a Helia `peerId` and `addrs` to paste into the browser env.
- Browser uploads run the Storacha upload workflow:
  - `space/blob/add` (per shard)
  - `space/index/add`
  - `filecoin/offer`
  - `upload/add`

### Passkey prompts (current pain point)

The upload flow currently requires multiple UCAN invocations, so WebAuthn
signatures happen multiple times. For typical uploads, this results in ~8
passkey prompts. This is **expected** with the current UCAN flow and is not a
bug in the UI; each invocation must be signed.

We added a pre-sign modal in the UI to show:
- File name and size.
- Capabilities that will be signed.
- A note that multiple passkey prompts are expected.

**This is still too many prompts for a good UX.** A future improvement should
reduce prompts or change the signing strategy.

## Configuration

### Local API (browser)

Use the local API and revocation endpoints:

```
VITE_UPLOAD_SERVICE_URL=http://127.0.0.1:8787 \
VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network \
VITE_REVOCATION_URL=http://127.0.0.1:8787 \
npm run dev:local
```

### Local Helia (browser)

The local server prints:
- `VITE_HELIA_PEER_ID=<peerId>`
- `VITE_HELIA_ADDRS=<multiaddr>`

You can provide only the multiaddr (peer id is derived from `/p2p/<peerId>`):

```
VITE_HELIA_ADDRS=/ip4/127.0.0.1/tcp/PORT/ws/p2p/PEER_ID npm run dev:local
```

The browser logs `🟣 Helia bootstrap active: { peerId, addrs }` when configured.

## Logging Enhancements

The local server now logs:
- Storage PUT byte length and CID filename.
- Blob add verification (registry + storage).
- Post-PUT checks (registry/storage after the blob is stored).
- List responses for `upload/list` and `space/blob/list` requests.
- Helia peer connect/disconnect events.

## Troubleshooting

- `assert/index` unauthorized:
  - Restart the local API and re-import a fresh delegation.
  - The server refreshes indexing/claims proofs at startup.
- Helia preview failure:
  - Ensure `npm run storacha:memory` is running.
  - Ensure `VITE_HELIA_ADDRS` includes `/ws/p2p/<peerId>`.

## Known Follow-ups

- Reduce passkey prompts:
  - Consider a dev mode to disable `filecoin/offer`.
  - Increase shard size to reduce blob count.
  - Explore a signing strategy that reduces repeated WebAuthn prompts.
- Improve Helia UX:
  - Auto-propagate Helia bootstrap values into a dev script.
