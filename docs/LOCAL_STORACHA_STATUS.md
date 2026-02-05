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

### Proposed fix: session delegation (one prompt per session)

Create a short-lived delegation from the hardware DID to an ephemeral session
signer (worker/in-memory). The user confirms **once** to mint the session
delegation, then all subsequent UCAN invocations are signed by the session key
without additional passkey prompts. This does **not** change the upload flow,
it just changes who signs the invocations.

Key ideas:
- Session delegation is time-bound (e.g. 5-15 minutes).
- Scope is limited to the upload capabilities only.
- The session signer lives in memory (not persisted).
- Every invocation includes the session delegation as a proof.
- Enable via `VITE_SESSION_DELEGATION=1` and optionally set
  `VITE_SESSION_DELEGATION_TTL_MIN=15`.

Implementation sketch (proposed changes in `web/src/lib/ucan-delegation.ts`):

```ts
// 1) Cache a short-lived session signer + proof in memory.
type SessionDelegation = {
  signer: UcanSigner<UcanDID<'key'>>;
  proof: string; // multibase delegation proof
  expiresAt: number;
};

private sessionDelegation: SessionDelegation | null = null;

private async ensureSessionDelegation(): Promise<SessionDelegation> {
  if (this.sessionDelegation && this.sessionDelegation.expiresAt > Date.now()) {
    return this.sessionDelegation;
  }

  const { Signer } = await import('@ucanto/principal/ed25519');
  const sessionSigner = await Signer.generate();

  const proof = await this.createDelegation(
    sessionSigner.did(),
    ['space/blob/add', 'space/index/add', 'filecoin/offer', 'upload/add'],
    0.25 // 15 minutes
  );

  this.sessionDelegation = {
    signer: sessionSigner,
    proof,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  return this.sessionDelegation;
}

// 2) Use the session signer for client operations.
private async getPrincipal(): Promise<UcanSigner<UcanDID<'key'>>> {
  const session = await this.ensureSessionDelegation();
  return session.signer;
}
```

```ts
// 3) Include the session delegation as a proof for each invocation.
const session = await this.ensureSessionDelegation();
const sessionProof = await this.parseDelegationProof(session.proof);

const client = await this.createClient(session.signer);
const unsafeClient = client as unknown as {
  _invocationConfig?: (abilities: Array<string | undefined>) => Promise<unknown>;
  __ucanUploadPatchApplied?: boolean;
};

if (unsafeClient._invocationConfig && !unsafeClient.__ucanUploadPatchApplied) {
  const original = unsafeClient._invocationConfig.bind(client);
  unsafeClient._invocationConfig = async (abilities) => {
    const config = await original(abilities);
    return { ...config, proofs: [sessionProof, ...(config as any).proofs ?? []] };
  };
  unsafeClient.__ucanUploadPatchApplied = true;
}
```

Notes:
- The session delegation should be created by the hardware signer when
  available, so `createDelegation()` will still trigger one WebAuthn prompt.
- Session TTL must be short to keep the security trade-off reasonable.
- This avoids passkey prompts per invocation while preserving UCAN proofs.
- Create the session delegation after credentials are set. Because it is
  in-memory, it must be re-created on each new browser session (or whenever the
  TTL expires).
- Current implementation only creates session delegations when direct Storacha
  credentials are present (hardware delegation chaining with proofs is not yet
  supported).

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

## Known Follow-ups

- Reduce passkey prompts:
  - Implement session delegation (above) to reduce prompts to 1 per session.
  - Optionally increase shard size to reduce invocation count.
  - Consider a dev mode that skips `filecoin/offer` for local testing.
- Improve Helia UX:
  - Auto-propagate Helia bootstrap values into a dev script.
- Documentation:
  - Add session-delegation flow to `docs/ARCHITECTURE_FLOW.md`.
