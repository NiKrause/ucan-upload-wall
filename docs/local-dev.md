# Local Development (Upload Service)

## Configuration

Set these in `web/.env`:

```bash
VITE_UPLOAD_SERVICE_URL=http://localhost:8787
VITE_UPLOAD_SERVICE_DID=did:web:test.up.storacha.network
```

If unset, the app defaults to production:

- URL: `https://up.storacha.network`
- DID: `did:web:up.storacha.network`

## Run the App

```bash
cd web
npm install
npm run dev
```

Restart Vite after changing `.env`.

## Local Upload Service Notes

- The app uses `VITE_UPLOAD_SERVICE_URL` for all Storacha client calls.
- Revocation checks may return 400 on local services; the UI treats this as not revoked.
- In E2E, the upload-api server is in-memory and started by `web/tests/delegation-upload-flow.spec.ts`.

## Troubleshooting

- If you still see production URLs, check the console config log and restart Vite.
- If uploads fail, confirm the local upload service is running and reachable.
- If Vite caches stale code, remove `web/node_modules/.vite` and restart.
