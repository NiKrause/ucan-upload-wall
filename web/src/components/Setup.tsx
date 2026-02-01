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
        <div className={`border-2 rounded-lg p-4 ${
          signingMode.mode === 'hardware' 
            ? 'bg-green-50 border-green-200' 
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              {signingMode.mode === 'hardware' ? (
                <Lock className="w-6 h-6 text-green-600" />
              ) : (
                <AlertCircle className="w-6 h-6 text-yellow-600" />
              )}
            </div>
            <div className="flex-1">
              <h3 className={`text-sm font-semibold mb-1 ${
                signingMode.mode === 'hardware' ? 'text-green-900' : 'text-yellow-900'
              }`}>
                {signingMode.mode === 'hardware' ? (
                  <>🔐 Hardware-Backed Security Active ({signingMode.algorithm || 'Ed25519'})</>
                ) : (
                  <>⚠️ Worker Mode Active (Less Secure)</>
                )}
              </h3>
              {signingMode.mode === 'hardware' ? (
                <div className="text-sm text-green-800 space-y-1">
                  <p className="font-medium">✅ Maximum Security Enabled:</p>
                  <ul className="ml-4 space-y-0.5">
                    <li>• Private keys stored in secure hardware (TPM/Secure Enclave)</li>
                    <li>• Biometric authentication required for each signature</li>
                    <li>• Keys cannot be extracted by malicious extensions</li>
                    <li>• XSS attacks cannot steal key material</li>
                    {signingMode.algorithm === 'P-256' && (
                      <li className="text-green-700 font-medium">
                        • Using P-256 with ucanto fork (Ed25519 not available on this hardware)
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="text-sm text-yellow-800 space-y-2">
                  <p className="font-medium">⚠️ Security Limitations:</p>
                  <ul className="ml-4 space-y-0.5 mb-2">
                    <li>• Keys stored encrypted in browser localStorage</li>
                    <li>• Keys exist in web worker memory during operations</li>
                    <li>• Vulnerable to malicious browser extensions</li>
                    <li>• Hardware mode not supported by your browser</li>
                  </ul>
                  <div className="bg-yellow-100 border border-yellow-300 rounded p-2 mt-2">
                    <p className="font-semibold text-yellow-900">
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
            <h3 className="text-lg font-semibold font-heading text-dark">Step 1: Create Ed25519 DID</h3>
            <p className="text-sm text-neutral-600">Create your decentralized identity</p>
          </div>
        </div>

        {!webauthnSupported && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">
              <strong>WebAuthn not supported.</strong> Your browser doesn't support WebAuthn (required for biometric security).
            </p>
          </div>
        )}

        {currentDID ? (
          <div className="space-y-3">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-900">DID Created Successfully</span>
              </div>
              
              {/* Show signing mode info */}
              {signingMode && (
                <div className="flex items-center gap-2 mb-2">
                  {signingMode.mode === 'hardware' ? (
                    <>
                      <Lock className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-800 font-medium">Hardware Mode</span>
                    </>
                  ) : (
                    <>
                      <Cpu className="w-4 h-4 text-yellow-600" />
                      <span className="text-sm text-yellow-800 font-medium">Worker Mode</span>
                    </>
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 text-xs bg-white px-3 py-2 rounded border border-green-300 font-mono break-all"
                  data-testid="did-display"
                >
                  {currentDID}
                </code>
                <button
                  onClick={handleCopyDID}
                  className="flex-shrink-0 p-2 text-green-700 hover:text-green-900 hover:bg-green-100 rounded transition-colors"
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
                <div className="mt-2 text-xs text-green-700">
                  <span className="font-medium">Key Algorithm:</span> {keyAlgorithm}
                  {isNativeEd25519 && <span className="ml-2 text-green-600">(Native WebAuthn Ed25519 ✨)</span>}
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
                  Create Ed25519 DID
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
              className="btn-accent w-full py-3"
            >
              <Shield className="w-5 h-5" />
              Save Credentials
            </button>
          ) : (
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
              <Check className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-green-900">Credentials Saved</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
