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
    if (selectedFile) {
      onFileSelect(selectedFile);
      setSelectedFile(null);
    }
  }, [selectedFile, onFileSelect]);

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

  const hasCredentials = !!delegationService.getStorachaCredentials();
  const hasReceivedDelegations = delegationService.getReceivedDelegations().length > 0;
  const canUpload = hasCredentials || hasReceivedDelegations;

  return (
    <div className="w-full max-w-2xl space-y-6">
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
            
            {/* Two-button choice for authenticator type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Platform Authenticator (Touch ID / Face ID) */}
              <button
                onClick={() => handleCreateDID('platform')}
                disabled={isCreatingDID}
                className="bg-blue-600 text-white px-6 py-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-2 border-transparent hover:border-blue-800 text-left"
              >
                <div className="flex items-start">
                  <Lock className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold mb-1">🔒 Touch ID / Face ID</div>
                    <div className="text-sm text-blue-100 opacity-90">
                      Built-in biometric security with additional verification
                    </div>
                  </div>
                </div>
              </button>

              {/* Cross-platform Authenticator (USB/NFC Keys) */}
              <button
                onClick={() => handleCreateDID('cross-platform')}
                disabled={isCreatingDID}
                className="bg-green-600 text-white px-6 py-4 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-2 border-transparent hover:border-green-800 text-left"
              >
                <div className="flex items-start">
                  <Shield className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold mb-1">🔑 Security Key</div>
                    <div className="text-sm text-green-100 opacity-90">
                      Ledger, YubiKey, or other USB/NFC device
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {isCreatingDID && (
              <div className="text-center text-gray-600 py-2">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2"></div>
                Generating secure identity...
              </div>
            )}

            <div className="text-xs text-gray-500 mt-2 p-3 bg-gray-50 rounded">
              <strong>Note:</strong> Choose the option that matches your available hardware. 
              Both methods create a secure Ed25519 DID with hardware-backed protection.
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
                <code className="block text-xs text-green-700 mt-1 break-all">
                  {currentDID.substring(0, 30)}...{currentDID.slice(-10)}
                </code>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(currentDID)}
              className="flex items-center text-green-600 hover:text-green-800 ml-2"
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
