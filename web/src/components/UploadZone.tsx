import { useCallback, useState, useEffect } from 'react';
import { Upload, FileText, X, Shield, Copy, Check, AlertCircle, Lock } from 'lucide-react';
import { UCANDelegationService } from '../lib/ucan-delegation';
import { WebAuthnDIDProvider } from '../lib/webauthn-did';

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isUploading: boolean;
  delegationService: UCANDelegationService;
  onDidCreated?: () => void;
}

export function UploadZone({ onFileSelect, isUploading, delegationService, onDidCreated }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentDID, setCurrentDID] = useState<string | null>(null);
  const [isCreatingDID, setIsCreatingDID] = useState(false);
  const [webauthnSupported, setWebauthnSupported] = useState(false);
  const [copiedDID, setCopiedDID] = useState(false);
  const [encryptionSupported] = useState(false);
  const [authenticatorMode, setAuthenticatorMode] = useState<'platform' | 'cross-platform'>('platform');
  const [showSignConfirm, setShowSignConfirm] = useState(false);
  const [skipSignConfirm, setSkipSignConfirm] = useState(
    () => localStorage.getItem('skip_upload_sign_confirm') === 'true'
  );
  const [rememberSignChoice, setRememberSignChoice] = useState(false);
  const [signingMode, setSigningMode] = useState<{
    mode: 'hardware' | 'worker';
    did: string | null;
    secure: boolean;
    algorithm?: 'Ed25519' | 'P-256';
  } | null>(null);

  useEffect(() => {
    setWebauthnSupported(WebAuthnDIDProvider.isSupported());
    const did = delegationService.getCurrentDID();
    setCurrentDID(did);
    setSigningMode(delegationService.getSigningMode());
  }, [delegationService]);

  const handleCreateDID = async (authenticatorType?: 'platform' | 'cross-platform') => {
    setIsCreatingDID(true);
    try {
      if (encryptionSupported) {
        try {
          await delegationService.initializeEd25519DID(false, authenticatorType);
        } catch (encryptionError: unknown) {
          console.warn('Hardware encryption failed, using unencrypted:', encryptionError instanceof Error ? encryptionError.message : String(encryptionError));
          await delegationService.initializeEd25519DID(false, authenticatorType);
        }
      } else {
        await delegationService.initializeEd25519DID(false, authenticatorType);
      }

      const did = delegationService.getCurrentDID();
      setCurrentDID(did);
      setSigningMode(delegationService.getSigningMode());

      if (onDidCreated) {
        onDidCreated();
      }
    } catch (error) {
      alert(`Failed to create DID: ${error}`);
    } finally {
      setIsCreatingDID(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDID(true);
      setTimeout(() => setCopiedDID(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      setSelectedFile(file);

      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      }
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setSelectedFile(file);

      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      }
    }
  }, []);

  const handleUpload = useCallback(() => {
    if (!selectedFile) {
      return;
    }
    if (!skipSignConfirm) {
      setShowSignConfirm(true);
      return;
    }
    onFileSelect(selectedFile);
    setSelectedFile(null);
  }, [selectedFile, skipSignConfirm, onFileSelect]);

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const handleConfirmSign = useCallback(() => {
    if (!selectedFile) {
      setShowSignConfirm(false);
      return;
    }
    if (rememberSignChoice) {
      localStorage.setItem('skip_upload_sign_confirm', 'true');
      setSkipSignConfirm(true);
    }
    setShowSignConfirm(false);
    onFileSelect(selectedFile);
    setSelectedFile(null);
  }, [rememberSignChoice, onFileSelect, selectedFile]);

  const handleCancelSign = useCallback(() => {
    setShowSignConfirm(false);
  }, []);

  const hasCredentials = !!delegationService.getStorachaCredentials();
  const hasReceivedDelegations = delegationService.getReceivedDelegations().length > 0;
  const canUpload = hasCredentials || hasReceivedDelegations;

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* Sign Confirmation Modal */}
      {showSignConfirm && selectedFile && (
        <div className="fixed inset-0 bg-dark/50 flex items-center justify-center p-4 z-50">
          <div className="card max-w-lg w-full p-6 animate-fade-in">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <div className="w-8 h-8 bg-accent-purple rounded-lg flex items-center justify-center mr-3">
                  <Lock className="h-4 w-4 text-accent-blue" />
                </div>
                <h3 className="text-lg font-heading font-semibold text-dark">Confirm WebAuthn Signatures</h3>
              </div>
              <button
                onClick={handleCancelSign}
                className="text-neutral-400 hover:text-neutral-600 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-neutral-700">
              <div>
                <span className="font-medium">File:</span> {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </div>
              <div>
                <span className="font-medium">Capabilities to sign:</span>
                <ul className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <li className="bg-neutral-100 rounded-lg px-3 py-2 font-mono text-neutral-600">space/blob/add</li>
                  <li className="bg-neutral-100 rounded-lg px-3 py-2 font-mono text-neutral-600">space/index/add</li>
                  <li className="bg-neutral-100 rounded-lg px-3 py-2 font-mono text-neutral-600">filecoin/offer</li>
                  <li className="bg-neutral-100 rounded-lg px-3 py-2 font-mono text-neutral-600">upload/add</li>
                </ul>
              </div>
              {currentDID && (
                <div className="text-xs text-neutral-500 font-mono bg-neutral-50 p-2 rounded-lg">
                  <span className="font-medium font-sans">Signer DID:</span> {currentDID}
                </div>
              )}
              <div className="text-xs text-neutral-500 bg-accent-purple/30 p-3 rounded-lg">
                WebAuthn signatures are generated per invocation. Large files may produce multiple
                <code className="mx-1 bg-white px-1 rounded">space/blob/add</code> and <code className="mx-1 bg-white px-1 rounded">filecoin/offer</code>
                invocations, so you may see multiple passkey prompts.
              </div>
              <label className="flex items-center text-xs text-neutral-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="mr-2 rounded border-neutral-300 text-storacha-red focus:ring-storacha-red"
                  checked={rememberSignChoice}
                  onChange={(e) => setRememberSignChoice(e.target.checked)}
                />
                Don't show this confirmation again
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleCancelSign}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSign}
                className="btn-primary"
                data-testid="confirm-upload-sign"
              >
                Continue to Passkey
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WebAuthn Not Supported Warning */}
      {!webauthnSupported && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-storacha-red mr-3" />
            <div>
              <h3 className="text-primary-800 font-semibold">WebAuthn Not Supported</h3>
              <p className="text-primary-700 text-sm">
                Your browser doesn't support WebAuthn. Please use a modern browser like Chrome, Firefox, or Safari.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* DID Setup Section */}
      {!currentDID ? (
        <div className="card p-6 border border-primary-200">
          <div className="flex items-center mb-4">
            <div className="w-10 h-10 bg-accent-purple rounded-lg flex items-center justify-center mr-3">
              <Shield className="h-5 w-5 text-accent-blue" />
            </div>
            <h3 className="text-lg font-heading font-semibold text-dark">
              Step 1: Create DID
            </h3>
          </div>

          <div className="space-y-4">
            <p className="text-neutral-600">
              Choose how to create your secure identity:
            </p>

            {/* Authenticator Mode Toggle */}
            <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-1">
              <button
                type="button"
                onClick={() => setAuthenticatorMode('platform')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
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
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
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
              disabled={isCreatingDID}
              className="btn-primary flex items-center"
              data-testid="create-did-button"
            >
              {authenticatorMode === 'platform' ? (
                <Lock className="h-4 w-4 mr-2" />
              ) : (
                <Shield className="h-4 w-4 mr-2" />
              )}
              {isCreatingDID ? 'Generating...' : 'Create Secure DID'}
            </button>

            {isCreatingDID && (
              <div className="text-center text-neutral-600 py-2 flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-accent-blue border-t-transparent mr-2"></div>
                Generating secure identity...
              </div>
            )}

            <div className="text-xs text-neutral-500 p-3 bg-neutral-50 rounded-lg">
              <strong>Note:</strong> Switch to Hardware if you want to use a USB/NFC security key.
              Standard uses built-in biometric authentication.
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-accent-purple rounded-xl border border-accent-blue p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-accent-blue rounded-lg flex items-center justify-center mr-3">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div>
                <span className="text-accent-blue-dark font-medium">
                  {signingMode?.algorithm ? `${signingMode.algorithm} DID Active` : 'DID Active'}
                </span>
                <code
                  className="block text-xs text-accent-blue-dark mt-1 break-all font-mono"
                  data-testid="did-display"
                >
                  {currentDID.substring(0, 30)}...{currentDID.slice(-10)}
                </code>
                {signingMode && (
                  <p className="text-xs text-neutral-600 mt-1">
                    Signer mode: {signingMode.mode === 'hardware' ? 'Hardware-backed' : 'Worker-based'}
                    {signingMode.algorithm ? ` (${signingMode.algorithm})` : ''}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(currentDID)}
              className="flex items-center text-accent-blue hover:text-accent-blue-dark p-2 hover:bg-primary-100 rounded-lg transition-colors"
              data-testid="copy-did-button"
            >
              {copiedDID ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Upload Credentials Warning */}
      {!canUpload && currentDID && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-storacha-red mr-3" />
            <div>
              <h3 className="text-primary-800 font-semibold">Upload Credentials Needed</h3>
              <p className="text-primary-700 text-sm">
                Go to the Delegations tab to add Storacha credentials or import a delegation to enable uploads.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-8 md:p-12 transition-all duration-200
          ${isDragging ? 'border-storacha-red bg-primary-50' : 'border-neutral-300 bg-white'}
          ${isUploading || !canUpload ? 'opacity-50 pointer-events-none' : 'hover:border-neutral-400 hover:shadow-card'}
        `}
      >
        <div className="flex flex-col items-center gap-4">
          <div className={`
            p-4 rounded-full transition-colors
            ${isDragging ? 'bg-primary-100' : 'bg-neutral-100'}
          `}>
            <Upload className={`w-8 h-8 ${isDragging ? 'text-storacha-red' : 'text-neutral-600'}`} />
          </div>

          {!selectedFile ? (
            <>
              <div className="text-center">
                <p className="text-lg font-heading font-semibold text-dark mb-1">
                  Drop your file here
                </p>
                <p className="text-sm text-neutral-500">
                  or click to browse from your device
                </p>
              </div>

              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileInput}
                  disabled={isUploading}
                />
                <span className="btn-primary">
                  Select File
                </span>
              </label>
            </>
          ) : (
            <div className="w-full">
              {/* Image Preview */}
              {previewUrl && (
                <div className="mb-4 flex justify-center">
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-w-full max-h-64 rounded-xl border border-neutral-200 shadow-card object-contain"
                  />
                </div>
              )}

              <div className="flex items-center gap-3 p-4 bg-neutral-50 rounded-xl">
                <FileText className="w-5 h-5 text-neutral-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-dark truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
                <button
                  onClick={handleClear}
                  className="p-2 hover:bg-neutral-200 rounded-lg transition-colors"
                  disabled={isUploading}
                >
                  <X className="w-4 h-4 text-neutral-600" />
                </button>
              </div>

              <button
                onClick={handleUpload}
                disabled={isUploading}
                className="btn-primary w-full mt-4"
              >
                {isUploading ? 'Uploading...' : 'Upload to Storacha'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Upload Progress */}
      {isUploading && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-neutral-600">
          <div className="w-2 h-2 bg-storacha-red rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-2 h-2 bg-storacha-red rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-2 h-2 bg-storacha-red rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          <span className="ml-2">Securing your file with UCAN</span>
        </div>
      )}
    </div>
  );
}
