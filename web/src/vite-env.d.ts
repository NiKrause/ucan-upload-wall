/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPLOAD_SERVICE_URL?: string;
  readonly VITE_UPLOAD_SERVICE_DID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
