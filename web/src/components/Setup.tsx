import { useState, useEffect } from 'react';
import { Key, Shield, Copy, Check, AlertCircle, Lock, Cpu } from 'lucide-react';
import { UCANDelegationService } from '../lib/ucan-delegation';
import { getStoredHardwareSignerInfo } from '../lib/hardware-ucan-service';
import { WebAuthnDIDProvider } from '../lib/webauthn-did';

interface SetupProps {
  delegationService: UCANDelegationService;
  onSetupComplete?: () => void;
  onDidCreated?: () => void;
}

export function Setup({ delegationService, onSetupComplete, onDidCreated }: SetupProps) {
  const [credentials, setCredentials] = useState({
    key: '',
    proof: '',
    spaceDid: ''
  });
  const [currentDID, setCurrentDID] = useState<string | null>(null);
  const [keyAlgorithm, setKeyAlgorithm] = useState<'Ed25519' | 'P-256' | null>(null);
  const [isNativeEd25519, setIsNativeEd25519] = useState(false);
  const [isCreatingDID, setIsCreatingDID] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [webauthnSupported, setWebauthnSupported] = useState(false);
  const [authenticatorMode, setAuthenticatorMode] = useState<'platform' | 'cross-platform'>('platform');
  
  // NEW: Hardware mode detection
  const [signingMode, setSigningMode] = useState<{
    mode: 'hardware' | 'worker';
    did: string | null;
    secure: boolean;
    algorithm?: 'Ed25519' | 'P-256';
  } | null>(null);

  useEffect(() => {
    // Check WebAuthn support
    setWebauthnSupported(WebAuthnDIDProvider.isSupported());
    
    // Load existing credentials
    const existing = delegationService.getStorachaCredentials();
    if (existing) {
      setCredentials(existing);
      setSavedCredentials(true);
    }

    // Load existing DID and key algorithm info
    const did = delegationService.getCurrentDID();
    setCurrentDID(did);
    
    // NEW: Check signing mode
    const mode = delegationService.getSigningMode();
    setSigningMode(mode);
    
    // Load WebAuthn credential info to check key type
    const credInfo = localStorage.getItem('webauthn_credential_info');
    if (credInfo) {
      try {
        const parsed = JSON.parse(credInfo);
        setKeyAlgorithm(parsed.keyAlgorithm || 'P-256');
        setIsNativeEd25519(parsed.isNativeEd25519 || false);
      } catch (e) {
        console.error('Failed to parse credential info:', e);
      }
    } else {
      const storedHardware = getStoredHardwareSignerInfo();
      if (storedHardware) {
        setKeyAlgorithm(storedHardware.algorithm);
        setIsNativeEd25519(false);
      }
    }
  }, [delegationService]);

  const handleCredentialChange = (field: keyof typeof credentials, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveCredentials = () => {
    if (!credentials.key || !credentials.proof || !credentials.spaceDid) {
      alert('Please fill in all credential fields');
      return;
    }

    delegationService.storeStorachaCredentials(credentials);
    setSavedCredentials(true);
    
    if (currentDID && onSetupComplete) {
      onSetupComplete();
    }
  };

  const handleCreateDID = async (authenticatorType?: 'platform' | 'cross-platform') => {
    setIsCreatingDID(true);
    try {
      // Simple unencrypted Ed25519 DID stored in localStorage
      await delegationService.initializeEd25519DID(false, authenticatorType);
      
      const did = delegationService.getCurrentDID();
      setCurrentDID(did);
      
      // NEW: Update signing mode after initialization
      const mode = delegationService.getSigningMode();
      setSigningMode(mode);
      
      // Load key algorithm info
      const credInfo = localStorage.getItem('webauthn_credential_info');
      if (credInfo) {
        try {
          const parsed = JSON.parse(credInfo);
          setKeyAlgorithm(parsed.keyAlgorithm || 'P-256');
          setIsNativeEd25519(parsed.isNativeEd25519 || false);
        } catch (e) {
          console.error('Failed to parse credential info:', e);
        }
      } else {
        const storedHardware = getStoredHardwareSignerInfo();
        if (storedHardware) {
          setKeyAlgorithm(storedHardware.algorithm);
          setIsNativeEd25519(false);
        }
      }
      
      // Notify parent that DID was created
      if (onDidCreated) {
        onDidCreated();
      }
      
      if (savedCredentials && onSetupComplete) {
        onSetupComplete();
      }
    } catch (error) {
      console.error('Failed to create DID:', error);
      alert('Failed to create DID. Please try again.');
    } finally {
      setIsCreatingDID(false);
    }
  };

  const handleCopyDID = async () => {
    if (currentDID) {
      await navigator.clipboard.writeText(currentDID);
      setCopiedField('did');
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleCopyField = async (field: keyof typeof credentials) => {
    if (credentials[field]) {
      await navigator.clipboard.writeText(credentials[field]);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* NEW: Security Mode Banner */}
      {currentDID && signingMode && (
        <div className={`border rounded-xl p-4 ${
          signingMode.mode === 'hardware' 
            ? 'bg-accent-purple border-accent-blue' 
            : 'bg-primary-50 border-primary-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              {signingMode.mode === 'hardware' ? (
                <Lock className="w-6 h-6 text-accent-blue" />
              ) : (
                <AlertCircle className="w-6 h-6 text-storacha-red" />
              )}
            </div>
            <div className="flex-1">
              <h3 className={`text-sm font-semibold mb-1 ${
                signingMode.mode === 'hardware' ? 'text-accent-blue-dark' : 'text-primary-800'
              }`}>
                {signingMode.mode === 'hardware' ? (
                  <>🔐 Hardware-backed signer active ({signingMode.algorithm || 'Unknown'})</>
                ) : (
                  <>⚠️ Worker-based signer active</>
                )}
              </h3>
              {signingMode.mode === 'hardware' ? (
                <div className="text-sm text-accent-blue-dark space-y-1">
                  <p className="font-medium">✅ Hardware protections enabled:</p>
                  <ul className="ml-4 space-y-0.5">
                    <li>• Signing operations are delegated to your authenticator when supported.</li>
                    <li>• Passkey/biometric confirmation is typically required for signatures.</li>
                    <li>• Key extraction is significantly harder than worker-based mode.</li>
                    <li>• This reduces, but does not eliminate, browser-side attack risk.</li>
                    {signingMode.algorithm === 'P-256' && (
                      <li className="text-accent-blue-dark font-medium">
                        • Using P-256 signer fallback because native WebAuthn Ed25519 is unavailable.
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="text-sm text-primary-700 space-y-2">
                  <p className="font-medium">⚠️ Security Limitations:</p>
                  <ul className="ml-4 space-y-0.5 mb-2">
                    <li>• Key material is managed in browser context (worker + local storage state).</li>
                    <li>• Browser compromise or malicious extensions increase risk.</li>
                    <li>• Hardware-backed signing is unavailable in the current environment.</li>
                  </ul>
                  <div className="bg-white border border-primary-300 rounded-lg p-2 mt-2">
                    <p className="font-semibold text-primary-800">
                      🛡️ Recommended Security Practices:
                    </p>
                    <ul className="ml-4 mt-1 space-y-0.5">
                      <li>• Use a browser with NO extensions installed</li>
                      <li>• Use a dedicated browser profile for this app</li>
                      <li>• Avoid browsers with unknown/untrusted addons</li>
                      <li>• Consider using mobile devices (better isolation)</li>
                      <li>• Update to Chrome 108+, Edge 108+, or Safari 17+ for hardware mode</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Create or Load DID */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
            <Key className="w-5 h-5 text-storacha-red" />
          </div>
          <div>
            <h3 className="text-lg font-semibold font-heading text-dark">Step 1: Create DID</h3>
            <p className="text-sm text-neutral-600">Create your decentralized identity</p>
          </div>
        </div>

        {!webauthnSupported && (
          <div className="mb-4 p-3 bg-primary-50 border border-primary-200 rounded-xl">
            <p className="text-sm text-primary-800">
              <strong>WebAuthn not supported.</strong> Your browser doesn't support WebAuthn (required for biometric security).
            </p>
          </div>
        )}

        {currentDID ? (
          <div className="space-y-3">
            <div className="p-4 bg-accent-purple border border-accent-blue rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-accent-blue" />
                <span className="font-medium text-accent-blue-dark">
                  {keyAlgorithm ? `${keyAlgorithm} DID Created` : 'DID Created Successfully'}
                </span>
              </div>
              
              {/* Show signing mode info */}
              {signingMode && (
                <div className="flex items-center gap-2 mb-2">
                  {signingMode.mode === 'hardware' ? (
                    <>
                      <Lock className="w-4 h-4 text-accent-blue" />
                      <span className="text-sm text-accent-blue-dark font-medium">Hardware Mode</span>
                    </>
                  ) : (
                    <>
                      <Cpu className="w-4 h-4 text-primary-700" />
                      <span className="text-sm text-primary-800 font-medium">Worker Mode</span>
                    </>
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 text-xs bg-white px-3 py-2 rounded border border-primary-200 font-mono break-all"
                  data-testid="did-display"
                >
                  {currentDID}
                </code>
                <button
                  onClick={handleCopyDID}
                  className="flex-shrink-0 p-2 text-accent-blue hover:text-accent-blue-dark hover:bg-primary-100 rounded transition-colors"
                  title="Copy DID"
                  data-testid="copy-did-button"
                >
                  {copiedField === 'did' ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              
              {keyAlgorithm && (
                <div className="mt-2 text-xs text-accent-blue-dark">
                  <span className="font-medium">Key Algorithm:</span> {keyAlgorithm}
                  {isNativeEd25519 && <span className="ml-2 text-accent-blue">(Native WebAuthn Ed25519 ✨)</span>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-50 p-1">
              <button
                type="button"
                onClick={() => setAuthenticatorMode('platform')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  authenticatorMode === 'platform'
                    ? 'bg-white text-dark shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Standard (Touch ID / Face ID)
              </button>
              <button
                type="button"
                onClick={() => setAuthenticatorMode('cross-platform')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  authenticatorMode === 'cross-platform'
                    ? 'bg-white text-dark shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Hardware (Security Key)
              </button>
            </div>
            <button
              onClick={() => handleCreateDID(authenticatorMode)}
              disabled={!webauthnSupported || isCreatingDID}
              className="btn-primary w-full py-3 disabled:bg-neutral-400 disabled:cursor-not-allowed"
              data-testid="create-did-button"
            >
              {isCreatingDID ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating DID...
                </>
              ) : (
                <>
                  {authenticatorMode === 'platform' ? (
                    <Lock className="w-5 h-5" />
                  ) : (
                    <Shield className="w-5 h-5" />
                  )}
                  Create Secure DID
                </>
              )}
            </button>
            <div className="text-xs text-neutral-500 mt-2 p-3 bg-neutral-50 rounded-lg">
              <strong>Note:</strong> Switch to Hardware if you want to use a USB/NFC security key.
              Standard uses built-in biometric authentication.
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Add Storacha Credentials */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-accent-purple rounded-full flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent-blue" />
          </div>
          <div>
            <h3 className="text-lg font-semibold font-heading text-dark">Step 2: Storacha Credentials (Optional)</h3>
            <p className="text-sm text-neutral-600">Add your Storacha account credentials for direct uploads</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Private Key
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={credentials.key}
                onChange={(e) => handleCredentialChange('key', e.target.value)}
                placeholder="MgCY...base64..."
                className="input-field flex-1"
                disabled={savedCredentials}
              />
              {savedCredentials && (
                <button
                  onClick={() => handleCopyField('key')}
                  className="p-2 text-neutral-600 hover:text-dark hover:bg-neutral-100 rounded-lg transition-colors"
                  title="Copy key"
                >
                  {copiedField === 'key' ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Delegation Proof
            </label>
            <div className="flex gap-2">
              <textarea
                value={credentials.proof}
                onChange={(e) => handleCredentialChange('proof', e.target.value)}
                placeholder="uOqJl..."
                rows={3}
                className="input-field flex-1 font-mono text-sm"
                disabled={savedCredentials}
              />
              {savedCredentials && (
                <button
                  onClick={() => handleCopyField('proof')}
                  className="p-2 text-neutral-600 hover:text-dark hover:bg-neutral-100 rounded-lg transition-colors"
                  title="Copy proof"
                >
                  {copiedField === 'proof' ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Space DID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={credentials.spaceDid}
                onChange={(e) => handleCredentialChange('spaceDid', e.target.value)}
                placeholder="did:key:z6Mk..."
                className="input-field flex-1 font-mono text-sm"
                disabled={savedCredentials}
              />
              {savedCredentials && (
                <button
                  onClick={() => handleCopyField('spaceDid')}
                  className="p-2 text-neutral-600 hover:text-dark hover:bg-neutral-100 rounded-lg transition-colors"
                  title="Copy space DID"
                >
                  {copiedField === 'spaceDid' ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {!savedCredentials ? (
            <button
              onClick={handleSaveCredentials}
              className="btn-primary w-full py-3"
            >
              <Shield className="w-5 h-5" />
              Save Credentials
            </button>
          ) : (
            <div className="p-3 bg-accent-purple border border-accent-blue rounded-xl flex items-center gap-2">
              <Check className="w-5 h-5 text-accent-blue" />
              <span className="text-sm font-medium text-accent-blue-dark">Credentials Saved</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
