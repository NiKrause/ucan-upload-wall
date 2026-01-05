import { useState, useEffect } from 'react';
import { Key, Shield, Copy, Check, AlertCircle } from 'lucide-react';
import { UCANDelegationService } from '../lib/ucan-delegation';
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
  const [isCreatingDID, setIsCreatingDID] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [webauthnSupported, setWebauthnSupported] = useState(false);

  useEffect(() => {
    // Check WebAuthn support
    setWebauthnSupported(WebAuthnDIDProvider.isSupported());
    
    // Load existing credentials
    const existing = delegationService.getStorachaCredentials();
    if (existing) {
      setCredentials(existing);
      setSavedCredentials(true);
    }

    // Load existing DID
    const did = delegationService.getCurrentDID();
    setCurrentDID(did);
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

  const handleCreateDID = async () => {
    setIsCreatingDID(true);
    try {
      // Simple unencrypted Ed25519 DID stored in localStorage
      await delegationService.initializeEd25519DID(false);
      
      const did = delegationService.getCurrentDID();
      setCurrentDID(did);
      
      // Notify parent that DID was created
      if (onDidCreated) {
        onDidCreated();
      }
      
      if (savedCredentials && onSetupComplete) {
        onSetupComplete();
      }
    } catch (error) {
      alert(`Failed to create DID: ${error}`);
    } finally {
      setIsCreatingDID(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const isSetupComplete = savedCredentials && currentDID;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-3">
          Browser-Only Setup
        </h2>
        <p className="text-gray-600">
          Set up WebAuthn DID authentication and Storacha credentials for decentralized file uploads
        </p>
      </div>

      {/* WebAuthn Support Check */}
      {!webauthnSupported && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-500 mr-3" />
            <div>
              <h3 className="text-red-800 font-medium">WebAuthn Not Supported</h3>
              <p className="text-red-700 text-sm">
                Your browser doesn't support WebAuthn. Please use a modern browser like Chrome, Firefox, or Safari.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: WebAuthn DID */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center mb-4">
          <Key className="h-6 w-6 text-blue-500 mr-3" />
          <h3 className="text-xl font-semibold text-gray-900">
            Step 1: Create Ed25519 DID
          </h3>
        </div>
        
        <div className="space-y-4">
          <p className="text-gray-600">
            Generate an Ed25519 DID for UCAN delegations. The private key will be stored in your browser (no extra WebAuthn keystore encryption).
          </p>
          
          {currentDID ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-green-500" />
                  <div>
                    <span className="text-green-800 font-medium">Ed25519 DID Created</span>
                  </div>
                </div>
              <button
                onClick={() => copyToClipboard(currentDID, 'did')}
                className="flex items-center text-green-600 hover:text-green-800"
                data-testid="copy-did-button"
              >
                {copiedField === 'did' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2">
              <code 
                className="text-sm text-green-700 bg-green-100 px-2 py-1 rounded break-all"
                data-testid="did-display"
              >
                {currentDID}
              </code>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={handleCreateDID}
              disabled={isCreatingDID || !webauthnSupported}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              data-testid="create-did-button"
            >
              <Key className="h-4 w-4 mr-2" />
              {isCreatingDID ? 'Generating...' : 'Create DID'}
            </button>
          </div>
        )}
        </div>
      </div>

      {/* Storacha Credentials */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center mb-4">
          <Key className="h-6 w-6 text-purple-500 mr-3" />
          <h3 className="text-xl font-semibold text-gray-900">
            Step 2: Add Storacha Credentials
          </h3>
        </div>

        <div className="space-y-4">
          <p className="text-gray-600">
            Paste your Storacha space credentials. These will be stored securely in your browser.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Private Key
              </label>
              <textarea
                value={credentials.key}
                onChange={(e) => handleCredentialChange('key', e.target.value)}
                placeholder="Paste your Storacha private key here..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Space Proof
              </label>
              <textarea
                value={credentials.proof}
                onChange={(e) => handleCredentialChange('proof', e.target.value)}
                placeholder="Paste your Storacha space proof here..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Space DID
              </label>
              <input
                type="text"
                value={credentials.spaceDid}
                onChange={(e) => handleCredentialChange('spaceDid', e.target.value)}
                placeholder="did:key:..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
              />
            </div>

            <button
              onClick={handleSaveCredentials}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center"
            >
              <Key className="h-4 w-4 mr-2" />
              Save Credentials
            </button>

            {savedCredentials && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center">
                  <Check className="h-5 w-5 text-green-500 mr-2" />
                  <span className="text-green-800 font-medium">Credentials Saved</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Setup Complete */}
      {isSetupComplete && (
        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200 p-6">
          <div className="text-center">
            <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Setup Complete!
            </h3>
            <p className="text-gray-600 mb-4">
              You can now upload files and create UCAN delegations using WebAuthn authentication.
            </p>
            {onSetupComplete && (
              <button
                onClick={onSetupComplete}
                className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700"
              >
                Continue to App
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}