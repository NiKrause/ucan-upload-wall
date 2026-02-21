# Step 5 Migration Checklist

Scope reference: Issue #13, Phase 5 (`ucan-upload-wall` migration to standalone toolkit).

## Checklist

- [x] Replace local crypto/worker/signer implementations with toolkit imports.
  - `web/src/lib/hardware-ucan-service.ts`
  - `web/src/lib/webauthn-did.ts`
  - `web/src/lib/ucan-delegation.ts`

- [x] Keep app-specific UCAN business logic in upload-wall.
  - `web/src/lib/ucan-delegation.ts` remains app-owned orchestration.

- [x] Remove migration-only Vite filesystem workaround to external source tree.
  - Removed `server.fs.allow` path to `../../orbitdb-identity-provider-webauthn-did/src/standalone/worker` in `web/vite.config.ts`.

- [x] Remove local duplicate worker-keystore crypto implementation.
  - Worker-keystore wrappers removed; app imports standalone worker APIs directly.

- [x] Verify compile + critical flow after migration cleanup.
  - `npm run typecheck` in `web`
  - Worker fallback delegation flow e2e (`delegation-upload-flow.spec.ts`, full workflow test)

## Remaining deliberate local translation

- `web/src/lib/webauthn-did.ts`

Reason: preserves app credential/storage shape compatibility while runtime crypto
operations are delegated to `@le-space/orbitdb-identity-provider-webauthn-did/standalone`.
