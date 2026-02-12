import { Shield } from 'lucide-react';
import { UCANDelegationService } from '../lib/ucan-delegation';
import { getServiceConfig } from '../lib/service-config';

interface HeaderProps {
  delegationService?: UCANDelegationService;
}

export function Header({ delegationService }: HeaderProps) {
  const currentDID = delegationService?.getCurrentDID();
  const signingMode = delegationService?.getSigningMode();
  const serviceConfig = getServiceConfig();
  const uploadUrl = serviceConfig.uploadServiceUrl ?? '';
  const isLocalService =
    uploadUrl.startsWith('http://127.0.0.1') || uploadUrl.startsWith('http://localhost');
  const sessionStatus = delegationService?.getSessionDelegationStatus();
  const sessionDid = delegationService?.getSessionDelegationDid();
  const detectedAlgorithm =
    signingMode?.algorithm ??
    (currentDID?.startsWith('did:key:zDna') ? 'P-256' : currentDID ? 'Ed25519' : null);
  const didStatusLabel = detectedAlgorithm ? `${detectedAlgorithm} DID Active` : 'DID Active';
  const didStatusTitle =
    detectedAlgorithm === 'P-256'
      ? 'P-256 DID active. Signatures are generated with a hardware-backed WebAuthn signer when available.'
      : 'Ed25519 DID active. Keys are stored locally in your browser (no extra WebAuthn keystore encryption).';

  const sessionLabel = (() => {
    if (!sessionStatus?.enabled) {
      return { text: 'Session Delegation: Off', className: 'bg-gray-100 text-gray-700' };
    }
    if (sessionStatus.active) {
      const expiresAt = sessionStatus.expiresAt
        ? new Date(sessionStatus.expiresAt).toLocaleTimeString()
        : 'unknown';
      return { text: `Session Delegation: Active (until ${expiresAt})`, className: 'bg-green-100 text-green-800' };
    }
    return { text: 'Session Delegation: Pending', className: 'bg-amber-100 text-amber-800' };
  })();
  
  return (
    <header className="w-full bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              🔐 UCAN Upload Wall <span className="text-lg text-blue-600">(Browser-Only)</span>
              {isLocalService && (
                <span
                  className="ml-3 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
                  title={`Local upload service: ${uploadUrl || 'unknown'}`}
                >
                  LOCAL API
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-600">
              WebAuthn DID +{' '}
              <a 
                href="https://storacha.network" 
                target="_blank" 
                rel="noopener noreferrer"
                className="font-medium text-blue-600 hover:text-blue-800 border-b border-dotted border-blue-400 transition-colors"
                title="Storacha network: Uploads use centralized gateways for reliability. Downloads leverage the decentralized IPFS network for resilience and censorship resistance."
              >
                Storacha Network
              </a>
              {' '}• UCAN Delegation • No Servers
            </p>
          </div>
          
              {/* Security indicator */}
          {currentDID && (
            <div className="flex items-center gap-3">
              {/* Security status */}
              <div 
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200"
                title={didStatusTitle}
                data-testid="header-did-status"
              >
                <Shield className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">{didStatusLabel}</span>
              </div>
              {sessionStatus && (
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold ${sessionLabel.className}`}
                  title={
                    sessionStatus.active
                      ? `Session delegation is active (reduced passkey prompts). Session DID: ${sessionDid ?? 'unknown'}`
                      : sessionStatus.enabled
                        ? 'Session delegation will activate after credentials or a delegation are available.'
                        : 'Session delegation disabled. Set VITE_SESSION_DELEGATION=1 to enable.'
                  }
                >
                  {sessionLabel.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
