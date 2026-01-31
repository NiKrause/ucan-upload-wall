import { Shield } from 'lucide-react';
import { UCANDelegationService } from '../lib/ucan-delegation';
import { getServiceConfig } from '../lib/service-config';

interface HeaderProps {
  delegationService?: UCANDelegationService;
}

export function Header({ delegationService }: HeaderProps) {
  const currentDID = delegationService?.getCurrentDID();
  const serviceConfig = getServiceConfig();
  const uploadUrl = serviceConfig.uploadServiceUrl ?? '';
  const isLocalService =
    uploadUrl.startsWith('http://127.0.0.1') || uploadUrl.startsWith('http://localhost');

  return (
    <header className="w-full bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Logo/Brand */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-storacha-red rounded-lg flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-heading font-semibold text-dark flex items-center gap-2">
                  UCAN Upload Wall
                  <span className="text-sm font-normal text-accent-blue">(Browser-Only)</span>
                  {isLocalService && (
                    <span
                      className="badge-warning text-2xs"
                      title={`Local upload service: ${uploadUrl || 'unknown'}`}
                    >
                      LOCAL API
                    </span>
                  )}
                </h1>
                <p className="text-sm text-neutral-500">
                  WebAuthn DID •{' '}
                  <a
                    href="https://storacha.network"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-storacha-red hover:text-storacha-red-dark transition-colors"
                    title="Storacha network: Uploads use centralized gateways for reliability. Downloads leverage the decentralized IPFS network for resilience and censorship resistance."
                  >
                    Storacha Network
                  </a>
                  {' '}• UCAN Delegation • No Servers
                </p>
              </div>
            </div>
          </div>

          {/* Security indicator */}
          {currentDID && (
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-purple border border-accent-purple-dark"
                title="Ed25519 DID active. Keys are stored locally in your browser."
              >
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse-slow" />
                <span className="text-sm font-medium text-accent-blue-dark">Ed25519 DID Active</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
