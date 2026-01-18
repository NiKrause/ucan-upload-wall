type RuntimeOverrides = {
  __UPLOAD_SERVICE_URL__?: string;
  __UPLOAD_SERVICE_DID__?: string;
  __REVOCATION_URL__?: string;
  __REVOCATION_DID__?: string;
  __RECEIPTS_URL__?: string;
};

function getRuntimeOverrides(): RuntimeOverrides {
  if (typeof globalThis === 'undefined') {
    return {};
  }

  const overrides = globalThis as RuntimeOverrides;
  return {
    __UPLOAD_SERVICE_URL__: overrides.__UPLOAD_SERVICE_URL__,
    __UPLOAD_SERVICE_DID__: overrides.__UPLOAD_SERVICE_DID__,
    __REVOCATION_URL__: overrides.__REVOCATION_URL__,
    __REVOCATION_DID__: overrides.__REVOCATION_DID__,
    __RECEIPTS_URL__: overrides.__RECEIPTS_URL__,
  };
}

export type ServiceConfig = {
  uploadServiceUrl?: string;
  uploadServiceDid?: string;
  revocationUrl?: string;
  revocationDid?: string;
  receiptsUrl?: string;
};

export function getServiceConfig(): ServiceConfig {
  const runtime = getRuntimeOverrides();

  return {
    uploadServiceUrl: runtime.__UPLOAD_SERVICE_URL__ ?? import.meta.env.VITE_UPLOAD_SERVICE_URL,
    uploadServiceDid: runtime.__UPLOAD_SERVICE_DID__ ?? import.meta.env.VITE_UPLOAD_SERVICE_DID,
    revocationUrl: runtime.__REVOCATION_URL__ ?? import.meta.env.VITE_REVOCATION_URL,
    revocationDid: runtime.__REVOCATION_DID__ ?? import.meta.env.VITE_REVOCATION_DID,
    receiptsUrl: runtime.__RECEIPTS_URL__ ?? import.meta.env.VITE_RECEIPTS_URL,
  };
}
