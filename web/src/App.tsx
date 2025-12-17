import { useState, useCallback, useEffect } from 'react';
import { Upload, Share, Download, Calendar, Clock, Trash2, RefreshCw } from 'lucide-react';
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
  
  useEffect(() => {
    // Check if DID is available
    const hasDID = !!delegationService.getCurrentDID();
    setDidCreated(hasDID);
    
    // Check delete capability
    setHasDeleteCapability(delegationService.hasDeleteCapability());
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
    }, 1000);
    
    return () => clearInterval(interval);
  }, [didCreated, delegationService]);

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
          />
        );
      
      case 'upload':
      default:
        return (
          <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="flex flex-col items-center">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-gray-900 mb-3">
                  Store it your way
                </h2>
                <p className="text-lg text-gray-600 max-w-2xl">
                  Upload files directly to the Storacha network with WebAuthn DID + UCAN authorization.
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
