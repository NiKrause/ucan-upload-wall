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
  const [encryptionSupported] = useState(false); // Currently always false - encryption handled in worker
  const [authenticatorMode, setAuthenticatorMode] = useState<'platform' | 'cross-platform'>('platform');
  const [showSignConfirm, setShowSignConfirm] = useState(false);
  const [skipSignConfirm, setSkipSignConfirm] = useState(
    () => localStorage.getItem('skip_upload_sign_confirm') === 'true'
  );
  const [rememberSignChoice, setRememberSignChoice] = useState(false);

  useEffect(() => {
    // Check WebAuthn support
    setWebauthnSupported(WebAuthnDIDProvider.isSupported());
    
    // Load existing DID
    const did = delegationService.getCurrentDID();
    setCurrentDID(did);
  }, [delegationService]);

  const handleCreateDID = async (authenticatorType?: 'platform' | 'cross-platform') => {
    setIsCreatingDID(true);
    try {
      // Use encrypted keystore if supported, fallback to unencrypted
      if (encryptionSupported) {
        try {
          await delegationService.initializeEd25519DID(false, authenticatorType);
        } catch (encryptionError: unknown) {
          // Safari doesn't support encryption extensions - fall back to unencrypted
          console.warn('Hardware encryption failed, using unencrypted:', encryptionError instanceof Error ? encryptionError.message : String(encryptionError));
          await delegationService.initializeEd25519DID(false, authenticatorType);
        }
      } else {
        await delegationService.initializeEd25519DID(false, authenticatorType);
      }
      
      const did = delegationService.getCurrentDID();
      setCurrentDID(did);
      
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
      
      // Create preview for images
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
      
      // Create preview for images
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
      {showSignConfirm && selectedFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <Lock className="h-5 w-5 text-blue-600 mr-2" />
                <h3 className="text-lg font-semibold text-gray-900">Confirm WebAuthn Signatures</h3>
              </div>
              <button
                onClick={handleCancelSign}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-gray-700">
              <div>
                <span className="font-medium">File:</span> {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </div>
              <div>
                <span className="font-medium">Capabilities to sign:</span>
                <ul className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <li className="bg-gray-100 rounded px-2 py-1">space/blob/add</li>
                  <li className="bg-gray-100 rounded px-2 py-1">space/index/add</li>
                  <li className="bg-gray-100 rounded px-2 py-1">filecoin/offer</li>
                  <li className="bg-gray-100 rounded px-2 py-1">upload/add</li>
                </ul>
              </div>
              {currentDID && (
                <div className="text-xs text-gray-500">
                  <span className="font-medium">Signer DID:</span> {currentDID}
                </div>
              )}
              <div className="text-xs text-gray-500">
                WebAuthn signatures are generated per invocation. Large files may produce multiple
                <code className="mx-1">space/blob/add</code> and <code className="mx-1">filecoin/offer</code>
                invocations, so you may see multiple passkey prompts. A single signature for the
                entire upload is not supported in the current UCAN flow.
              </div>
              <label className="flex items-center text-xs text-gray-600">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={rememberSignChoice}
                  onChange={(e) => setRememberSignChoice(e.target.checked)}
                />
                Don’t show this confirmation again
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={handleCancelSign}
                className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSign}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                data-testid="confirm-upload-sign"
              >
                Continue to Passkey
              </button>
            </div>
          </div>
        </div>
      )}
      {/* WebAuthn DID Setup */}
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

      {!currentDID ? (
        <div className="bg-white rounded-lg border-2 border-blue-200 p-6">
          <div className="flex items-center mb-4">
            <Shield className="h-6 w-6 text-blue-500 mr-3" />
            <h3 className="text-xl font-semibold text-gray-900">
              Step 1: Create Ed25519 DID
            </h3>
          </div>
          
          <div className="space-y-4">
            <p className="text-gray-600">
              Choose how to create your secure identity:
            </p>
            
            {/* Toggle between standard and hardware modes */}
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setAuthenticatorMode('platform')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  authenticatorMode === 'platform'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Standard (Touch ID / Face ID)
              </button>
              <button
                type="button"
                onClick={() => setAuthenticatorMode('cross-platform')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  authenticatorMode === 'cross-platform'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Hardware (Security Key)
              </button>
            </div>

            <button
              onClick={() => handleCreateDID(authenticatorMode)}
              disabled={isCreatingDID}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              data-testid="create-did-button"
            >
              {authenticatorMode === 'platform' ? (
                <Lock className="h-4 w-4 mr-2" />
              ) : (
                <Shield className="h-4 w-4 mr-2" />
              )}
              {isCreatingDID ? 'Generating...' : 'Create DID'}
            </button>

            {isCreatingDID && (
              <div className="text-center text-gray-600 py-2">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2"></div>
                Generating secure identity...
              </div>
            )}

            <div className="text-xs text-gray-500 mt-2 p-3 bg-gray-50 rounded">
              <strong>Note:</strong> Switch to Hardware if you want to use a USB/NFC security key.
              Standard uses built-in biometric authentication.
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Shield className="h-5 w-5 text-green-500 mr-2" />
              <div>
                <span className="text-green-800 font-medium">Ed25519 DID Active</span>
                <code
                  className="block text-xs text-green-700 mt-1 break-all"
                  data-testid="did-display"
                >
                  {currentDID.substring(0, 30)}...{currentDID.slice(-10)}
                </code>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(currentDID)}
              className="flex items-center text-green-600 hover:text-green-800 ml-2"
              data-testid="copy-did-button"
            >
              {copiedDID ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Upload Zone */}
      {!canUpload && currentDID && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-orange-500 mr-3" />
            <div>
              <h3 className="text-orange-800 font-medium">Upload Credentials Needed</h3>
              <p className="text-orange-700 text-sm">
                Go to the Delegations tab to add Storacha credentials or import a delegation to enable uploads.
              </p>
            </div>
          </div>
        </div>
      )}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-12 transition-all duration-200
          ${isDragging ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'}
          ${isUploading || !canUpload ? 'opacity-50 pointer-events-none' : 'hover:border-gray-400'}
        `}
      >
        <div className="flex flex-col items-center gap-4">
          <div className={`
            p-4 rounded-full transition-colors
            ${isDragging ? 'bg-red-100' : 'bg-gray-100'}
          `}>
            <Upload className={`w-8 h-8 ${isDragging ? 'text-red-600' : 'text-gray-600'}`} />
          </div>

          {!selectedFile ? (
            <>
              <div className="text-center">
                <p className="text-lg font-medium text-gray-900 mb-1">
                  Drop your file here
                </p>
                <p className="text-sm text-gray-500">
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
                <span className="inline-flex items-center px-6 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors">
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
                    className="max-w-full max-h-64 rounded-lg border border-gray-200 shadow-sm object-contain"
                  />
                </div>
              )}
              
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                <FileText className="w-5 h-5 text-gray-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
                <button
                  onClick={handleClear}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                  disabled={isUploading}
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              <button
                onClick={handleUpload}
                disabled={isUploading}
                className="w-full mt-4 px-6 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? 'Uploading...' : 'Upload to Storacha'}
              </button>
            </div>
          )}
        </div>
      </div>

      {isUploading && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-600">
          <div className="w-2 h-2 bg-red-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-2 h-2 bg-red-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-2 h-2 bg-red-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          <span className="ml-2">Securing your file with UCAN</span>
        </div>
      )}
    </div>
  );
}
