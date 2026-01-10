import { useState, useCallback, useEffect } from 'react';
import { Upload, Share, Download, Calendar, Clock, Trash2, RefreshCw, X } from 'lucide-react';
import { Header } from './components/Header';
import { UploadZone } from './components/UploadZone';
import { Alert } from './components/Alert';
import { DelegationManager } from './components/DelegationManager';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useFileUpload } from './hooks/useFileUpload';
import { UploadedFile } from './types/upload';

type AppView = 'upload' | 'delegations';

function App() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [storachaFiles, setStorachaFiles] = useState<Array<{ root: string; shards?: string[]; insertedAt?: string; updatedAt?: string }>>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [deletingFiles, setDeletingFiles] = useState<Set<string>>(new Set());
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('upload');
  const [didCreated, setDidCreated] = useState(false);
  const { uploadFile, isUploading, error, delegationService } = useFileUpload();
  const [hasDeleteCapability, setHasDeleteCapability] = useState(false);
  const [securityNoticeDismissed, setSecurityNoticeDismissed] = useState(() => {
    return localStorage.getItem('security_notice_dismissed') === 'true';
  });
  
  // NEW: Track signing mode for security warnings
  const [signingMode, setSigningMode] = useState<{
    mode: 'hardware' | 'worker';
    did: string | null;
    secure: boolean;
  } | null>(null);
  
  useEffect(() => {
    // Check if DID is available
    const hasDID = !!delegationService.getCurrentDID();
    setDidCreated(hasDID);
    
    // Check delete capability
    setHasDeleteCapability(delegationService.hasDeleteCapability());
    
    // NEW: Check signing mode
    const mode = delegationService.getSigningMode();
    setSigningMode(mode);
  }, [delegationService]);
  
  // Separate effect to load files only when DID is ready
  useEffect(() => {
    const loadStorachaFiles = async () => {
      // Only try to load if we have a DID (authenticated)
      if (!didCreated) {
        console.log('Skipping file load - DID not initialized yet');
        return;
      }
      
      const hasCredentials = !!delegationService.getStorachaCredentials();
      const hasDelegations = delegationService.getReceivedDelegations().length > 0;
      
      if (hasCredentials || hasDelegations) {
        console.log('Loading files from Storacha...');
        setIsLoadingFiles(true);
        try {
          const files = await delegationService.listUploads();
          setStorachaFiles(files);
          console.log(`Loaded ${files.length} files from Storacha`);
        } catch (error) {
          console.error('Failed to load Storacha files:', error);
        } finally {
          setIsLoadingFiles(false);
        }
      }
    };
    
    loadStorachaFiles();
  }, [didCreated, delegationService]);
  
  // Add a periodic check for DID creation (since it might happen async)
  useEffect(() => {
    const interval = setInterval(() => {
      const hasDID = !!delegationService.getCurrentDID();
      if (hasDID !== didCreated) {
        setDidCreated(hasDID);
      }
      
      // NEW: Also check signing mode changes
      const mode = delegationService.getSigningMode();
      if (JSON.stringify(mode) !== JSON.stringify(signingMode)) {
        setSigningMode(mode);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [didCreated, signingMode, delegationService]);

  const handleFileSelect = useCallback(async (file: File) => {
    const result = await uploadFile(file);

    if (result && result.ok) {
      const newFile: UploadedFile = {
        id: crypto.randomUUID(),
        cid: result.cid,
        filename: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      };

      setUploadedFiles(prev => [newFile, ...prev]);
      setAlert({
        type: 'success',
        message: `Successfully uploaded ${file.name}!`,
      });
      
      // Reload files from Storacha after successful upload
      try {
        const files = await delegationService.listUploads();
        setStorachaFiles(files);
      } catch (error) {
        console.error('Failed to reload Storacha files after upload:', error);
      }
      
    } else if (error) {
      setAlert({
        type: 'error',
        message: error,
      });
    }
  }, [uploadFile, error, delegationService]);

  const handleCloseAlert = useCallback(() => {
    setAlert(null);
  }, []);
  
  const handleDeleteFile = useCallback(async (rootCid: string) => {
    if (!confirm('Are you sure you want to delete this file?')) {
      return;
    }
    
    setDeletingFiles(prev => new Set(prev).add(rootCid));
    
    try {
      await delegationService.deleteUpload(rootCid);
      
      // Remove from local state
      setStorachaFiles(prev => prev.filter(f => f.root !== rootCid));
      
      setAlert({
        type: 'success',
        message: 'File deleted successfully!',
      });
    } catch (error) {
      console.error('Delete failed:', error);
      setAlert({
        type: 'error',
        message: `Failed to delete file: ${error}`,
      });
    } finally {
      setDeletingFiles(prev => {
        const next = new Set(prev);
        next.delete(rootCid);
        return next;
      });
    }
  }, [delegationService]);

  const handleDidCreated = () => {
    // Callback for when DID is created
    const hasDID = !!delegationService.getCurrentDID();
    setDidCreated(hasDID);
  };
  
  const handleDelegationImported = useCallback(async () => {
    // After importing a delegation, reload files and switch to upload view
    console.log('🎉 Delegation imported! Reloading files and switching to upload view...');
    
    // Reload files in background
    setIsLoadingFiles(true);
    try {
      const files = await delegationService.listUploads();
      setStorachaFiles(files);
      console.log(`✅ Loaded ${files.length} files after delegation import`);
    } catch (error) {
      console.error('Failed to reload files after delegation import:', error);
    } finally {
      setIsLoadingFiles(false);
    }
    
    // Switch to upload view
    setCurrentView('upload');
    
    // Show success notification
    setAlert({
      type: 'success',
      message: '✅ Delegation imported! You can now upload files.',
    });
  }, [delegationService]);
  
  const handleReloadFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    try {
      const files = await delegationService.listUploads();
      setStorachaFiles(files);
      setAlert({
        type: 'success',
        message: 'Files reloaded successfully!',
      });
    } catch (error) {
      console.error('Failed to reload files:', error);
      setAlert({
        type: 'error',
        message: `Failed to reload files: ${error}`,
      });
    } finally {
      setIsLoadingFiles(false);
    }
  }, [delegationService]);
  
  const handleDismissSecurityNotice = useCallback(() => {
    setSecurityNoticeDismissed(true);
    localStorage.setItem('security_notice_dismissed', 'true');
  }, []);
  
  const renderNavigation = () => {
    return (
      <nav className="bg-white border-b border-gray-200 mb-6">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-center space-x-8">
            <button
              onClick={() => setCurrentView('upload')}
              className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                currentView === 'upload'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Upload className="h-4 w-4 inline mr-2" />
              Upload Files
            </button>
            
            <button
              onClick={() => setCurrentView('delegations')}
              className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                currentView === 'delegations'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Share className="h-4 w-4 inline mr-2" />
              Delegations
            </button>
          </div>
        </div>
      </nav>
    );
  };

  const renderContent = () => {
    switch (currentView) {
      case 'delegations':
        return (
          <DelegationManager 
            delegationService={delegationService}
            onDidCreated={handleDidCreated}
            onDelegationImported={handleDelegationImported}
          />
        );
      
      case 'upload':
      default:
        return (
          <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="flex flex-col items-center">
              {/* Security Warning - Conditional based on signing mode */}
              {!securityNoticeDismissed && signingMode && (
                <div className={`w-full max-w-3xl mb-8 border-2 rounded-lg p-4 relative ${
                  signingMode.mode === 'hardware' 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-yellow-50 border-yellow-200'
                }`}>
                  <button
                    onClick={handleDismissSecurityNotice}
                    className={`absolute top-3 right-3 transition-colors ${
                      signingMode.mode === 'hardware'
                        ? 'text-green-600 hover:text-green-800'
                        : 'text-yellow-600 hover:text-yellow-800'
                    }`}
                    aria-label="Dismiss security notice"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="flex items-start gap-3 pr-8">
                    <div className="flex-shrink-0">
                      {signingMode.mode === 'hardware' ? (
                        <svg className="w-6 h-6 text-green-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-6 h-6 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      {signingMode.mode === 'hardware' ? (
                        <>
                          <h3 className="text-sm font-semibold text-green-900 mb-1">🔐 Hardware-Backed Security Active</h3>
                          <p className="text-sm text-green-800">
                            Your browser supports <strong>hardware-backed WebAuthn Ed25519</strong> signing! 
                            Your private keys are stored in secure hardware (TPM/Secure Enclave) and <strong>cannot be extracted</strong> by malicious extensions or XSS attacks.
                            <strong className="block mt-1">✅ Biometric authentication is required for each UCAN signature.</strong>
                          </p>
                        </>
                      ) : (
                        <>
                          <h3 className="text-sm font-semibold text-yellow-900 mb-1">⚠️ Worker Mode Security Notice</h3>
                          <p className="text-sm text-yellow-800">
                            This app uses <strong>web worker key storage</strong> (hardware mode not supported by your browser). 
                            While keys are encrypted, <strong>malicious browser extensions can potentially access key material</strong> from the worker memory.
                            <strong className="block mt-2">🛡️ Recommended actions to reduce risk:</strong>
                          </p>
                          <ul className="text-sm text-yellow-800 ml-6 mt-1 space-y-0.5">
                            <li>• Use a browser with <strong>NO extensions</strong> installed</li>
                            <li>• Use a <strong>dedicated browser profile</strong> for this app</li>
                            <li>• <strong>Avoid unknown or untrusted addons</strong></li>
                            <li>• Consider using <strong>mobile devices</strong> (better isolation)</li>
                            <li>• <strong>Update to Chrome 108+, Edge 108+, or Safari 17+</strong> for hardware mode</li>
                          </ul>
                          <p className="text-sm text-yellow-800 mt-2">
                            <strong>Note:</strong> This app has <strong>not been security audited</strong>.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-gray-900 mb-3">
                  Decentralised File Backup
                </h2>
                <p className="text-lg text-gray-600 max-w-2xl">
                  on{' '}
                  <a 
                    href="https://filecoin.io" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:text-blue-800 border-b-2 border-dotted border-blue-400 transition-colors"
                    title="Filecoin: Decentralized storage network for humanity's most important information"
                  >
                    Filecoin
                  </a>
                  {' '}via{' '}
                  <a 
                    href="https://storacha.network" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:text-blue-800 border-b-2 border-dotted border-blue-400 transition-colors"
                    title="Storacha network: Uploads use centralized gateways for reliability. Downloads leverage the decentralized IPFS network for resilience and censorship resistance."
                  >
                    Storacha network
                  </a>
                  {' '}with WebAuthn DID + UCAN authorization.
                  Your data stays verifiable, private, and under your control — no servers, no intermediaries.
                </p>
              </div>

              <UploadZone 
                onFileSelect={handleFileSelect} 
                isUploading={isUploading}
                delegationService={delegationService}
                onDidCreated={handleDidCreated}
              />
              
              {/* Show files from Storacha space */}
              {isLoadingFiles && (
                <div className="w-full max-w-2xl mt-12 text-center">
                  <p className="text-gray-600">Loading files from Storacha...</p>
                </div>
              )}
              
              {(didCreated && (delegationService.getStorachaCredentials() || delegationService.getReceivedDelegations().length > 0)) && (
                <div className="w-full max-w-2xl mt-12">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Files in Storacha Space</h2>
                    <button
                      onClick={handleReloadFiles}
                      disabled={isLoadingFiles}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Reload files from Storacha"
                    >
                      <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                      {isLoadingFiles ? 'Loading...' : 'Reload'}
                    </button>
                  </div>
                  
                  {storachaFiles.length === 0 && !isLoadingFiles ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                      <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Files Yet</h3>
                      <p className="text-gray-500 max-w-sm mx-auto">
                        Upload your first file to see it here. Files uploaded to this space will appear in this list.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                    {storachaFiles.map((file, index) => {
                      const gatewayUrl = `https://w3s.link/ipfs/${file.root}`;
                      const isImage = file.root.startsWith('bafkrei'); // Most images use raw codec
                      
                      return (
                        <div key={file.root} className="bg-white rounded-lg border border-gray-200 p-4">
                          <div className="flex items-start gap-4">
                            {/* Preview thumbnail */}
                            <div className="flex-shrink-0">
                              {isImage ? (
                                <img 
                                  src={gatewayUrl} 
                                  alt="Preview"
                                  className="w-16 h-16 rounded object-cover border border-gray-200"
                                  onError={(e) => {
                                    // Fallback to generic icon if image fails to load
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="w-16 h-16 rounded bg-gray-100 flex items-center justify-center border border-gray-200">
                                  <Upload className="w-6 h-6 text-gray-400" />
                                </div>
                              )}
                            </div>
                            
                            {/* File info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="text-sm font-semibold text-gray-900">
                                  Upload #{index + 1}
                                </h3>
                                <div className="flex items-center gap-2">
                                  <a
                                    href={gatewayUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 flex-shrink-0"
                                  >
                                    <Download className="w-3 h-3" />
                                    View
                                  </a>
                                  {hasDeleteCapability && (
                                    <button
                                      onClick={() => handleDeleteFile(file.root)}
                                      disabled={deletingFiles.has(file.root)}
                                      className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                      title="Delete file"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      {deletingFiles.has(file.root) ? 'Deleting...' : 'Delete'}
                                    </button>
                                  )}
                                </div>
                              </div>
                              
                              <code className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded block break-all mt-1">
                                {file.root}
                              </code>
                              
                              {/* Metadata */}
                              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                                {file.insertedAt && (
                                  <div className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    <span>{new Date(file.insertedAt).toLocaleDateString()}</span>
                                  </div>
                                )}
                                {file.updatedAt && (
                                  <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span>{new Date(file.updatedAt).toLocaleTimeString()}</span>
                                  </div>
                                )}
                                {file.shards && file.shards.length > 0 && (
                                  <span>{file.shards.length} shard{file.shards.length > 1 ? 's' : ''}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  )}
                </div>
              )}
              
              {/* Recently uploaded files in this session */}
              {uploadedFiles.length > 0 && (
                <div className="w-full max-w-2xl mt-12">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Recently Uploaded Files</h2>
                  <div className="space-y-3">
                    {uploadedFiles.map((file) => (
                      <div key={file.id} className="bg-white rounded-lg border border-gray-200 p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-gray-900 truncate">
                              {file.filename}
                            </h3>
                            <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                              <span>{Math.round(file.size / 1024)} KB</span>
                              <span>•</span>
                              <span>{new Date(file.uploadedAt).toLocaleString()}</span>
                            </div>
                            <div className="mt-2">
                              <code className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                                {file.cid}
                              </code>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Header delegationService={delegationService} />
        {renderNavigation()}
        <main>
          {renderContent()}
        </main>

        {alert && (
          <Alert
            type={alert.type}
            message={alert.message}
            onClose={handleCloseAlert}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
