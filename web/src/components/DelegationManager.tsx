import { useState, useEffect, useCallback } from 'react';
import { Share, Copy, Check, Plus, Download, Upload, Shield, Trash2, ArrowRight, User, Clock, Key, XCircle, Ban, Lock, Cpu } from 'lucide-react';
import { UCANDelegationService, DelegationInfo } from '../lib/ucan-delegation';
import { createCarFile } from '../lib/car-utils';
import { Setup } from './Setup';

interface DelegationManagerProps {
  delegationService: UCANDelegationService;
  onDidCreated?: () => void;
  onDelegationImported?: () => void;
  onDelegationUploaded?: (cid: string) => void;
}

export function DelegationManager({ delegationService, onDidCreated, onDelegationImported, onDelegationUploaded }: DelegationManagerProps) {
  const [currentDID, setCurrentDID] = useState<string | null>(null);
  const [isNativeEd25519, setIsNativeEd25519] = useState(false);
  const [createdDelegations, setCreatedDelegations] = useState<DelegationInfo[]>([]);
  const [receivedDelegations, setReceivedDelegations] = useState<DelegationInfo[]>([]);
  const [delegationStatus, setDelegationStatus] = useState<Record<string, { status: 'checking' | 'valid' | 'revoked' | 'expired' | 'invalid'; reason?: string }>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [targetDID, setTargetDID] = useState('');
  const [importProof, setImportProof] = useState('');
  const [delegationName, setDelegationName] = useState('');
  const [detectedInputType, setDetectedInputType] = useState<'token' | 'cid' | 'unknown'>('unknown');
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showDelegationProof, setShowDelegationProof] = useState(false);
  const [createdDelegationProof, setCreatedDelegationProof] = useState('');
  const [uploadedDelegationCID, setUploadedDelegationCID] = useState<string | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([
    'space/blob/add', 'upload/add'
  ]);
  const [expirationHours, setExpirationHours] = useState<number | null>(24);
  const [credentials, setCredentials] = useState({
    key: '',
    proof: '',
    spaceDid: ''
  });
  const [savedCredentials, setSavedCredentials] = useState(false);
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [revokingDelegation, setRevokingDelegation] = useState<string | null>(null);
  const [signingMode, setSigningMode] = useState<{
    mode: 'hardware' | 'worker';
    did: string | null;
    secure: boolean;
    algorithm?: 'Ed25519' | 'P-256';
  } | null>(null);

  // Available capabilities with descriptions
  const availableCapabilities = [
    // Upload capabilities
    { id: 'space/blob/add', label: 'Upload Files', description: 'Add files to the space', category: 'Upload' },
    { id: 'upload/add', label: 'Upload Files (Alt)', description: 'Alternative upload capability', category: 'Upload' },
    // List capabilities
    { id: 'upload/list', label: 'List Uploads', description: 'List all uploaded files', category: 'List' },
    { id: 'space/blob/list', label: 'List Blobs', description: 'List blobs in the space', category: 'List' },
    { id: 'store/list', label: 'List Stored Data', description: 'List stored data items', category: 'List' },
    { id: 'space/info', label: 'Space Info', description: 'Get space information', category: 'List' },
    // Delete capabilities
    { id: 'space/blob/remove', label: 'Delete Files (Space)', description: 'Remove files from the space', category: 'Delete' },
    { id: 'upload/remove', label: 'Delete Files (Upload)', description: 'Remove uploaded files', category: 'Delete' },
    // Store capabilities
    { id: 'store/add', label: 'Store Data', description: 'Store data in the space', category: 'Store' },
    { id: 'store/remove', label: 'Remove Stored Data', description: 'Remove stored data', category: 'Store' }
  ];

  const loadData = useCallback(() => {
    setCurrentDID(delegationService.getCurrentDID());
    setCreatedDelegations(delegationService.getCreatedDelegations());
    setReceivedDelegations(delegationService.getReceivedDelegations());
    setSigningMode(delegationService.getSigningMode());
    
    // Check if using native Ed25519 (cannot create delegations)
    const credInfo = localStorage.getItem('webauthn_credential_info');
    if (credInfo) {
      try {
        const parsed = JSON.parse(credInfo);
        setIsNativeEd25519(parsed.isNativeEd25519 || false);
      } catch (e) {
        console.error('Failed to parse credential info:', e);
      }
    }
  }, [delegationService]);

  useEffect(() => {
    loadData();
    
    // Load existing credentials
    const existing = delegationService.getStorachaCredentials();
    if (existing) {
      setCredentials(existing);
      setSavedCredentials(true);
    }
  }, [delegationService, loadData]);

  useEffect(() => {
    let cancelled = false;

    const checkDelegations = async () => {
      if (receivedDelegations.length === 0) {
        return;
      }

      const initialStatuses: Record<string, { status: 'checking' }> = {};
      for (const delegation of receivedDelegations) {
        initialStatuses[delegation.id] = { status: 'checking' };
      }
      setDelegationStatus((prev) => ({ ...prev, ...initialStatuses }));

      const results = await Promise.all(
        receivedDelegations.map(async (delegation) => {
          const validation = await delegationService.validateDelegation(delegation);
          if (!validation.valid) {
            const reason = validation.reason ?? 'Delegation is not valid';
            if (reason.toLowerCase().includes('expired')) {
              return [delegation.id, { status: 'expired', reason }] as const;
            }
            if (reason.toLowerCase().includes('revoked')) {
              return [delegation.id, { status: 'revoked', reason }] as const;
            }
            return [delegation.id, { status: 'invalid', reason }] as const;
          }
          return [delegation.id, { status: 'valid' }] as const;
        })
      );

      if (cancelled) return;
      setDelegationStatus((prev) => ({ ...prev, ...Object.fromEntries(results) }));
    };

    checkDelegations();

    return () => {
      cancelled = true;
    };
  }, [receivedDelegations, delegationService]);

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
    setShowCredentialsForm(false);
    alert('Credentials saved successfully!');
  };


  const handleCreateDelegation = async () => {
    if (!targetDID) {
      alert('Please enter a target DID');
      return;
    }

    if (selectedCapabilities.length === 0) {
      alert('Please select at least one capability to delegate');
      return;
    }

    setIsCreating(true);
    try {
      console.log('🔄 Creating delegation for target DID:', targetDID);
      console.log('🛠️ Selected capabilities:', selectedCapabilities);
      console.log('⏰ Expiration:', expirationHours, 'hours');
      const delegationProof = await delegationService.createDelegation(targetDID, selectedCapabilities, expirationHours);
      console.log('✅ Delegation created, proof length:', delegationProof?.length || 0);
      console.log('📄 Delegation proof preview:', delegationProof?.substring(0, 100) + '...');
      
      // Generate a CAR file from the delegation proof
      console.log('📁 Generating CAR file from delegation proof...');
      
      const carFile = await createCarFile(delegationProof, targetDID);
      
      console.log('✅ CAR file created, size:', carFile.size, 'bytes');
      console.log('📁 Filename created in createCarFile():', carFile.name);
      
      // Upload the file
      console.log('📤 Uploading delegation file...');
      const uploadResult = await delegationService.uploadFile(carFile);
      const cid = uploadResult.cid;
      console.log('✅ Delegation file uploaded, CID:', cid);
      if (onDelegationUploaded) {
        onDelegationUploaded(cid);
      }
      
      loadData();
      setShowCreateForm(false);
      setTargetDID('');
      
      // Show the created delegation proof and CID in modal
      if (delegationProof && delegationProof.length > 0) {
        setCreatedDelegationProof(delegationProof);
        setUploadedDelegationCID(cid);
        setShowDelegationProof(true);
        console.log('📋 Modal state set - showing delegation proof and CID');
      } else {
        console.error('❌ Empty delegation proof received!');
        alert('Delegation was created but proof is empty. Check console for details.');
      }
    } catch (error) {
      console.error('❌ Delegation creation failed:', error);
      alert(`Failed to create delegation: ${error}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Detect input type when user types
  const handleImportProofChange = (value: string) => {
    setImportProof(value);
    
    const cleaned = value.trim();
    if (!cleaned) {
      setDetectedInputType('unknown');
      return;
    }
    
    // Check if it looks like a CID
    const isCIDv1 = cleaned.startsWith('baf') && cleaned.length >= 46 && cleaned.length <= 62;
    const isCIDv0 = cleaned.startsWith('Qm') && cleaned.length >= 44 && cleaned.length <= 48;
    
    if (isCIDv1 || isCIDv0) {
      setDetectedInputType('cid');
    } else if (cleaned.startsWith('m') || cleaned.startsWith('u')) {
      setDetectedInputType('token');
    } else {
      setDetectedInputType('unknown');
    }
  };

  const handleImportDelegation = async () => {
    if (!importProof) {
      alert('Please paste a delegation proof or CID');
      return;
    }

    setIsImporting(true);
    try {
      await delegationService.importDelegation(importProof, delegationName || undefined);
      loadData();
      setShowImportForm(false);
      setImportProof('');
      setDelegationName(''); // Clear the name field
      setDetectedInputType('unknown'); // Reset detection
      
      // UX improvement: After successful import, automatically:
      // 1. Reload files in background (to show any existing uploads)
      // 2. Switch to upload view (user likely wants to upload next)
      // 3. Show success notification
      if (onDelegationImported) {
        onDelegationImported();
      }
    } catch (error) {
      alert(`Failed to import delegation: ${error}`);
    } finally {
      setIsImporting(false);
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

  const handleDeleteCreatedDelegations = () => {
    if (createdDelegations.length === 0) {
      alert('No created delegations to delete.');
      return;
    }
    
    if (confirm(`Are you sure you want to delete all ${createdDelegations.length} created delegation(s)? This action cannot be undone.`)) {
      delegationService.clearCreatedDelegations();
      loadData();
      alert('All created delegations have been deleted.');
    }
  };

  const handleDeleteReceivedDelegations = () => {
    if (receivedDelegations.length === 0) {
      alert('No received delegations to delete.');
      return;
    }
    
    if (confirm(`Are you sure you want to delete all ${receivedDelegations.length} received delegation(s)? This will remove your upload capabilities from other browsers.`)) {
      delegationService.clearReceivedDelegations();
      loadData();
      alert('All received delegations have been deleted.');
    }
  };

  const handleDeleteReceivedDelegation = (delegationId: string) => {
    const delegation = receivedDelegations.find((item) => item.id === delegationId);
    const label = delegation?.name ? `"${delegation.name}"` : delegationId;
    if (!confirm(`Delete this received delegation ${label}? This action cannot be undone.`)) {
      return;
    }
    delegationService.deleteReceivedDelegation(delegationId);
    setReceivedDelegations(delegationService.getReceivedDelegations());
    setDelegationStatus((prev) => {
      const next = { ...prev };
      delete next[delegationId];
      return next;
    });
  };

  const handleClearRevocationCache = async (delegationId: string) => {
    delegationService.clearRevocationCacheForDelegation(delegationId);
    setDelegationStatus((prev) => ({
      ...prev,
      [delegationId]: { status: 'checking' },
    }));
    const delegation = receivedDelegations.find((item) => item.id === delegationId);
    if (!delegation) {
      return;
    }
    const validation = await delegationService.validateDelegation(delegation);
    if (!validation.valid) {
      const reason = validation.reason ?? 'Delegation is not valid';
      const status = reason.toLowerCase().includes('expired')
        ? 'expired'
        : reason.toLowerCase().includes('revoked')
        ? 'revoked'
        : 'invalid';
      setDelegationStatus((prev) => ({
        ...prev,
        [delegationId]: { status, reason },
      }));
      return;
    }
    setDelegationStatus((prev) => ({
      ...prev,
      [delegationId]: { status: 'valid' },
    }));
  };

  const handleRevokeDelegation = async (delegationCID: string) => {
    if (!confirm('Are you sure you want to revoke this delegation?\n\nThis action CANNOT be undone. The recipient will immediately lose access.')) {
      return;
    }
    
    setRevokingDelegation(delegationCID);
    try {
      console.log('🔄 Revoking delegation:', delegationCID);
      const result = await delegationService.revokeDelegation(delegationCID);
      
      if (result.success) {
        alert('✅ Delegation revoked successfully!\n\nThe recipient can no longer use this delegation for uploads.');
        loadData(); // Refresh the delegation list
      } else {
        alert(`❌ Failed to revoke delegation:\n\n${result.error}`);
      }
    } catch (error) {
      console.error('Revocation error:', error);
      alert(`❌ Error revoking delegation:\n\n${error}`);
    } finally {
      setRevokingDelegation(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Show Setup component when no DID exists */}
      {!currentDID && (
        <Setup 
          delegationService={delegationService}
          onSetupComplete={() => {
            loadData();
            if (onDidCreated) {
              onDidCreated();
            }
          }}
        />
      )}

      {/* Show delegation management when DID exists */}
      {currentDID && (
        <>
          <div className="text-center">
            <h2 className="text-3xl font-bold text-dark mb-3">
              Setup Your Ed25519 DID & Upload Access
            </h2>
            <p className="text-neutral-600">
              Import a UCAN delegation token to get upload access, or add Storacha credentials directly
            </p>
          </div>

          {/* Current Ed25519 DID - Most Important! */}
          {currentDID && (
        <div className="bg-gradient-to-r from-primary-50 to-accent-purple border-2 border-storacha-red rounded-xl p-6 shadow-soft">
          <div className="flex items-center justify-between">
            <div className="flex items-center flex-1">
              <Shield className="h-6 w-6 text-storacha-red mr-3" />
              <div className="flex-1">
                <h3 className="text-lg font-bold font-heading text-dark mb-1">Your Ed25519 DID</h3>
                <p className="text-sm text-neutral-600 mb-2">Share this DID to receive UCAN delegations from Storacha CLI</p>
                {signingMode && (
                  <div className="flex items-center gap-2 mb-2">
                    {signingMode.mode === 'hardware' ? (
                      <>
                        <Lock className="h-4 w-4 text-green-600" />
                        <span className="text-sm text-green-800 font-medium">Hardware Mode</span>
                        {signingMode.algorithm ? (
                          <span className="text-xs text-green-700">({signingMode.algorithm})</span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Cpu className="h-4 w-4 text-yellow-600" />
                        <span className="text-sm text-yellow-800 font-medium">Worker Mode</span>
                      </>
                    )}
                  </div>
                )}
                <code className="text-sm text-dark break-all bg-white/60 px-3 py-2 rounded-lg border border-primary-200 block" data-testid="did-display">{currentDID}</code>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(currentDID, 'current-did')}
              className="btn-primary ml-4"
              data-testid="copy-did-button"
            >
              {copiedField === 'current-did' ? (
                <><Check className="h-4 w-4 mr-2" /> Copied!</>
              ) : (
                <><Copy className="h-4 w-4 mr-2" /> Copy DID</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Primary Action: Import UCAN Delegation */}
      <div className="card border-2 border-storacha-red">
        <div className="flex items-center mb-4">
          <Download className="h-6 w-6 text-storacha-red mr-3" />
          <div>
            <h3 className="text-xl font-bold font-heading text-dark">Import UCAN Delegation</h3>
            <p className="text-sm text-neutral-600">Recommended: Paste your UCAN token to get upload access</p>
          </div>
        </div>

        {receivedDelegations.length > 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
            <p className="text-green-800 text-sm font-medium">
              ✓ You have {receivedDelegations.length} active UCAN delegation(s). You can upload files!
            </p>
          </div>
        ) : null}

        <button
          onClick={() => setShowImportForm(!showImportForm)}
          className="btn-primary"
          data-testid="toggle-import-form-button"
        >
          <Download className="h-5 w-5 mr-2" />
          {showImportForm ? 'Hide Import Form' : 'Import UCAN Delegation'}
        </button>
      </div>

      {/* Secondary Option: Storacha Credentials */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Key className="h-6 w-6 text-accent-blue mr-3" />
            <div>
              <h3 className="text-xl font-semibold font-heading text-dark">
                Storacha Credentials (Alternative)
              </h3>
              <p className="text-sm text-neutral-600">Advanced: Add credentials directly if you have a Storacha account</p>
            </div>
          </div>
          {savedCredentials ? (
            <div className="flex items-center text-green-600">
              <Check className="h-5 w-5 mr-1" />
              <span className="text-sm font-medium">Saved</span>
            </div>
          ) : (
            <button
              onClick={() => setShowCredentialsForm(!showCredentialsForm)}
              className="text-storacha-red hover:text-storacha-red-dark text-sm font-medium transition-colors"
            >
              {showCredentialsForm ? 'Hide' : 'Add Credentials'}
            </button>
          )}
        </div>

        {savedCredentials ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-green-800 text-sm">
              ✓ Storacha credentials configured. You can now create delegations and upload files.
            </p>
            <button
              onClick={() => {
                setSavedCredentials(false);
                setShowCredentialsForm(true);
              }}
              className="mt-2 text-sm text-storacha-red hover:text-storacha-red-dark underline transition-colors"
            >
              Update credentials
            </button>
          </div>
        ) : (
          <>
            <p className="text-neutral-600 text-sm mb-4">
              Add Storacha space credentials to enable file uploads and delegation creation. Required if you didn't get a UCAN delegation from another person or device!
            </p>

            {showCredentialsForm && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Private Key
                  </label>
                  <textarea
                    value={credentials.key}
                    onChange={(e) => handleCredentialChange('key', e.target.value)}
                    placeholder="Paste your Storacha private key here..."
                    className="input-field font-mono text-sm"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Space Proof
                  </label>
                  <textarea
                    value={credentials.proof}
                    onChange={(e) => handleCredentialChange('proof', e.target.value)}
                    placeholder="Paste your Storacha space proof here..."
                    className="input-field font-mono text-sm"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Space DID
                  </label>
                  <input
                    type="text"
                    value={credentials.spaceDid}
                    onChange={(e) => handleCredentialChange('spaceDid', e.target.value)}
                    placeholder="did:key:..."
                    className="input-field font-mono text-sm"
                  />
                </div>

                <button
                  onClick={handleSaveCredentials}
                  className="btn-accent"
                >
                  <Key className="h-4 w-4 mr-2" />
                  Save Credentials
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Info message for native Ed25519 users */}
      {isNativeEd25519 && (savedCredentials || receivedDelegations.length > 0) && (
        <div className="bg-accent-purple border border-accent-blue rounded-xl p-4">
          <div className="flex items-start">
            <Shield className="h-5 w-5 text-accent-blue mr-3 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Delegation Creation Disabled</h4>
              <p className="text-sm text-neutral-700">
                You're using a hardware-backed native Ed25519 WebAuthn key. While this provides excellent security,
                WebAuthn keys cannot sign arbitrary UCAN delegation data. You can still:
              </p>
              <ul className="text-sm text-neutral-700 mt-2 ml-4 list-disc">
                <li>Import delegations created by others</li>
                <li>Use imported delegations to upload files</li>
                <li>Authenticate securely with biometrics</li>
              </ul>
              <p className="text-xs text-neutral-600 mt-2">
                💡 To create delegations, you'll need to use a P-256 key with the worker-based approach.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Create Delegation (show if user has credentials OR received delegations for chaining) */}
      {(savedCredentials || receivedDelegations.length > 0) && !isNativeEd25519 && (
        <div className="card">
          <div className="flex items-center mb-4">
            <Share className="h-6 w-6 text-storacha-red mr-3" />
            <div>
              <h3 className="text-xl font-semibold font-heading text-dark">Create Delegation for Others</h3>
              <p className="text-sm text-neutral-600">
                {savedCredentials
                  ? 'Share upload access with other DIDs using your Storacha credentials'
                  : 'Chain your UCAN delegation - share access with other DIDs'}
              </p>
            </div>
          </div>

          {!savedCredentials && receivedDelegations.length > 0 && (
            <div className="bg-accent-purple border border-accent-blue rounded-xl p-3 mb-4">
              <p className="text-accent-blue-dark text-sm">
                <strong>🔗 UCAN Chaining:</strong> You can re-delegate your received UCAN to another DID. This creates a delegation chain.
              </p>
            </div>
          )}

          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="btn-accent"
          >
            <Plus className="h-5 w-5 mr-2" />
            {showCreateForm ? 'Hide Form' : 'Create New Delegation'}
          </button>
        </div>
      )}

      {/* Create Delegation Form */}
      {showCreateForm && (
        <div className="card">
          <h3 className="text-xl font-semibold font-heading text-dark mb-4">
            Create New Delegation
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Target DID (from another browser)
              </label>
              <input
                type="text"
                value={targetDID}
                onChange={(e) => setTargetDID(e.target.value)}
                placeholder="did:key:..."
                className="input-field font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Delegation Expiration
              </label>
              <select
                value={expirationHours ?? 'never'}
                onChange={(e) => setExpirationHours(e.target.value === 'never' ? null : Number(e.target.value))}
                className="input-field"
              >
                <option value="never">No expiration (valid forever)</option>
                <option value={1}>1 hour</option>
                <option value={6}>6 hours</option>
                <option value={24}>24 hours (1 day)</option>
                <option value={72}>72 hours (3 days)</option>
                <option value={168}>1 week</option>
                <option value={720}>30 days (1 month)</option>
                <option value={8760}>1 year</option>
                <option value={87600}>10 years</option>
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                {expirationHours === null 
                  ? 'This delegation will never expire' 
                  : 'The delegation will expire after this time period'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-3">
                Select Capabilities to Delegate
              </label>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Group capabilities by category */}
                {['Upload', 'List', 'Delete', 'Store'].map(category => {
                  const categoryCapabilities = availableCapabilities.filter(cap => cap.category === category);
                  if (categoryCapabilities.length === 0) return null;
                  
                  return (
                    <div key={category} className="border border-neutral-200 rounded-xl p-4 hover:border-storacha-red transition-colors">
                      <h4 className="text-sm font-medium text-dark mb-3 flex items-center">
                        {category === 'Upload' && <Upload className="h-4 w-4 mr-2 text-storacha-red" />}
                        {category === 'List' && <ArrowRight className="h-4 w-4 mr-2 text-accent-blue" />}
                        {category === 'Delete' && <Trash2 className="h-4 w-4 mr-2 text-storacha-red" />}
                        {category === 'Store' && <Shield className="h-4 w-4 mr-2 text-accent-blue" />}
                        {category} Capabilities
                      </h4>
                      
                      <div className="space-y-2">
                        {categoryCapabilities.map(capability => (
                          <label key={capability.id} className="flex items-start space-x-3 cursor-pointer hover:bg-primary-50 p-2 rounded-lg transition-colors">
                            <input
                              type="checkbox"
                              checked={selectedCapabilities.includes(capability.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCapabilities(prev => [...prev, capability.id]);
                                } else {
                                  setSelectedCapabilities(prev => prev.filter(id => id !== capability.id));
                                }
                              }}
                              className="mt-1 h-4 w-4 text-storacha-red focus:ring-storacha-red border-neutral-300 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-dark">{capability.label}</div>
                              <div className="text-xs text-neutral-500">{capability.description}</div>
                              <code className="text-xs text-neutral-400 bg-neutral-100 px-1 py-0.5 rounded break-all">{capability.id}</code>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quick selection buttons */}
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities(['space/blob/add'])}
                  className="px-3 py-1 text-xs bg-primary-100 text-storacha-red rounded-lg hover:bg-primary-200 transition-colors"
                >
                  Basic Upload
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities(['space/blob/add', 'upload/add', 'upload/list'])}
                  className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                >
                  Recommended
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities(availableCapabilities.map(cap => cap.id))}
                  className="px-3 py-1 text-xs bg-accent-purple text-accent-blue-dark rounded-lg hover:bg-primary-100 transition-colors"
                >
                  All Capabilities
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities([])}
                  className="px-3 py-1 text-xs bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 transition-colors"
                >
                  Clear All
                </button>
              </div>
              
              <div className="text-xs text-neutral-500 mt-2">
                Selected: {selectedCapabilities.length} capability(ies)
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleCreateDelegation}
                disabled={isCreating}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Share className="h-4 w-4 mr-2" />
                {isCreating ? 'Creating...' : 'Create Delegation'}
              </button>

              <button
                onClick={() => setShowCreateForm(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import UCAN Delegation Form */}
      {showImportForm && (
        <div className="card border-2 border-storacha-red">
          <h3 className="text-xl font-bold font-heading text-dark mb-2">
            Import UCAN Delegation
          </h3>
          <p className="text-sm text-neutral-600 mb-4">
            Paste the base64 UCAN token that was delegated to your Ed25519 DID
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Delegation Name (Optional)
              </label>
              <input
                type="text"
                value={delegationName}
                onChange={(e) => setDelegationName(e.target.value)}
                placeholder="e.g., Alice's Upload Token, Work Laptop, etc."
                className="input-field"
              />
              <p className="text-xs text-neutral-500 mt-1">
                💡 Give this delegation a friendly name to remember where it came from
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                UCAN Token or CID
              </label>
              <textarea
                value={importProof}
                onChange={(e) => handleImportProofChange(e.target.value)}
                placeholder="Paste your UCAN token or CAR file CID here. Token example: mAYIEAKMYOqJlcm9vdHO. CID example: bafkreiabcd1234..."
                className="input-field font-mono text-sm"
                rows={6}
                data-testid="import-delegation-textarea"
              />
              <p className="text-xs text-neutral-500 mt-2">
                💡 Get token from `storacha delegation create YOUR_DID --base64` or use the CID from uploaded delegation
              </p>

              {detectedInputType !== 'unknown' && (
                <div
                  className={`mt-2 border rounded-lg p-3 ${
                    detectedInputType === 'cid'
                      ? 'bg-purple-50 border-purple-200'
                      : 'bg-blue-50 border-blue-200'
                  }`}
                  data-testid="detected-input-type"
                  data-input-type={detectedInputType}
                >
                  <div className="text-xs font-medium">
                    {detectedInputType === 'cid' ? (
                      <span className="text-purple-800">
                        🔍 <strong>Detected: CID</strong> - Will fetch delegation from IPFS
                      </span>
                    ) : (
                      <span className="text-blue-800">
                        ✓ <strong>Detected: UCAN Token</strong> - Will import directly
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-2 bg-accent-purple border border-accent-blue rounded-xl p-3">
                <div className="text-xs text-accent-blue-dark">
                  <strong>✓ Auto-detects format:</strong> Supports CIDs (bafk..., Qm...), Storacha CLI tokens (multibase-base64 with 'm' prefix),
                  base64url ('u' prefix), CAR files, and legacy JSON formats.
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleImportDelegation}
                disabled={isImporting}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="h-5 w-5 mr-2" />
                {isImporting ? 'Importing...' : 'Import UCAN Delegation'}
              </button>

              <button
                onClick={() => setShowImportForm(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Created Delegations */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Upload className="h-6 w-6 text-storacha-red mr-3" />
            <h3 className="text-xl font-semibold font-heading text-dark">
              Delegations Created ({createdDelegations.length})
            </h3>
          </div>
          {createdDelegations.length > 0 && (
            <button
              onClick={handleDeleteCreatedDelegations}
              className="bg-storacha-red text-white px-3 py-1.5 rounded-lg hover:bg-storacha-red-dark flex items-center text-sm transition-colors"
              title="Delete all created delegations"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete All
            </button>
          )}
        </div>

        {createdDelegations.length === 0 ? (
          <div className="text-center py-12 bg-neutral-50 rounded-xl border-2 border-dashed border-neutral-300">
            <Share className="mx-auto h-12 w-12 text-neutral-400 mb-4" />
            <h3 className="text-lg font-medium font-heading text-dark mb-2">No Delegations Created</h3>
            <p className="text-neutral-500 max-w-sm mx-auto">
              Create a delegation to share your upload capabilities with another browser.
              This allows others to upload files using your Storacha credentials.
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="btn-primary mt-4"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Delegation
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {createdDelegations.map((delegation) => (
              <div key={delegation.id} className={`border rounded-lg p-4 ${
                delegation.revoked 
                  ? 'border-red-300 bg-gradient-to-r from-red-50 to-orange-50 opacity-75' 
                  : delegation.expiresAt && new Date(delegation.expiresAt) < new Date()
                  ? 'border-orange-300 bg-gradient-to-r from-orange-50 to-yellow-50 opacity-75'
                  : 'border-neutral-200 bg-gradient-to-r from-green-50 to-emerald-50'
              }`}>
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <Share className="h-5 w-5 text-green-600 mr-2" />
                      <span className="font-semibold text-dark">Delegation Created</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {delegation.revoked ? (
                        <div className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded font-medium flex items-center">
                          <Ban className="h-3 w-3 mr-1" />
                          Revoked
                        </div>
                      ) : delegation.expiresAt && new Date(delegation.expiresAt) < new Date() ? (
                        <div className="bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded font-medium flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          Expired
                        </div>
                      ) : (
                        <div className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-medium flex items-center">
                          <Check className="h-3 w-3 mr-1" />
                          Active
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Delegation Chain Visualization */}
                  <div className="bg-white rounded-lg p-3 border border-green-200">
                    <div className="text-xs font-medium text-neutral-600 mb-2">DELEGATION FLOW:</div>
                    <div className="flex items-center space-x-2 text-sm">
                      <div className="flex items-center bg-green-100 px-2 py-1 rounded text-green-800">
                        <Shield className="h-3 w-3 mr-1" />
                        <span className="font-medium">You</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-neutral-400" />
                      <div className="flex items-center bg-orange-100 px-2 py-1 rounded text-orange-800">
                        <User className="h-3 w-3 mr-1" />
                        <span className="font-medium">Recipient</span>
                      </div>
                    </div>
                    
                    <div className="mt-3 space-y-2">
                      <div className="text-xs">
                        <span className="font-medium text-neutral-600">From:</span>
                        <code className="ml-1 text-xs bg-green-50 text-green-700 px-1 py-0.5 rounded">
                          {delegation.fromIssuer?.startsWith('did:key:') 
                            ? `${delegation.fromIssuer.slice(0, 20)}...${delegation.fromIssuer.slice(-8)}`
                            : delegation.fromIssuer || currentDID || 'Your DID'
                          }
                        </code>
                      </div>
                      <div className="text-xs">
                        <span className="font-medium text-neutral-600">To:</span>
                        <code className="ml-1 text-xs bg-orange-50 text-orange-700 px-1 py-0.5 rounded">
                          {delegation.toAudience.startsWith('did:key:') 
                            ? `${delegation.toAudience.slice(0, 20)}...${delegation.toAudience.slice(-8)}`
                            : delegation.toAudience
                          }
                        </code>
                      </div>
                    </div>
                  </div>
                  
                  {/* Delegation Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 text-neutral-400 mr-2" />
                        <span className="font-medium text-neutral-600">Created:</span>
                        <span className="ml-1 text-dark">
                          {new Date(delegation.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 text-neutral-400 mr-2" />
                        <span className="font-medium text-neutral-600">Expires:</span>
                        {delegation.expiresAt ? (
                          <span className={`ml-1 ${
                            new Date(delegation.expiresAt) < new Date() 
                              ? 'text-red-600 font-semibold' 
                              : new Date(delegation.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000
                              ? 'text-orange-600'
                              : 'text-dark'
                          }`}>
                            {new Date(delegation.expiresAt).toLocaleDateString()} {new Date(delegation.expiresAt).toLocaleTimeString()}
                            {new Date(delegation.expiresAt) < new Date() && ' (Expired)'}
                          </span>
                        ) : (
                          <span className="ml-1 text-green-600 font-medium">
                            Never (valid forever)
                          </span>
                        )}
                      </div>
                      
                      <div className="text-sm">
                        <span className="font-medium text-neutral-600">Delegation ID:</span>
                        <code className="ml-1 text-xs bg-neutral-100 text-neutral-700 px-1 py-0.5 rounded">
                          {delegation.id.length > 16 ? `${delegation.id.slice(0, 16)}...` : delegation.id}
                        </code>
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-sm font-medium text-neutral-600 mb-1">Capabilities Granted:</div>
                      <div className="flex flex-wrap gap-1">
                        {delegation.capabilities.map((cap, index) => (
                          <span key={index} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Revocation Info */}
                  {delegation.revoked && delegation.revokedAt && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-center text-red-800 text-sm font-medium mb-1">
                        <Ban className="h-4 w-4 mr-2" />
                        This delegation has been revoked
                      </div>
                      <div className="text-xs text-red-700">
                        <div>Revoked: {new Date(delegation.revokedAt).toLocaleString()}</div>
                        {delegation.revokedBy && (
                          <div className="mt-1">
                            By: <code className="bg-red-100 px-1 py-0.5 rounded">{delegation.revokedBy.slice(0, 20)}...</code>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-green-200">
                    <div className="text-xs text-neutral-500">
                      {delegation.revoked 
                        ? 'This delegation is no longer valid. The recipient cannot use it.' 
                        : 'Share this delegation proof with the recipient to grant them upload permissions'
                      }
                    </div>
                    <div className="flex items-center gap-2">
                      {!delegation.revoked && (
                        <button
                          onClick={() => handleRevokeDelegation(delegation.id)}
                          disabled={revokingDelegation === delegation.id}
                          className="flex items-center text-red-600 hover:text-red-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Revoke this delegation"
                        >
                          {revokingDelegation === delegation.id ? (
                            <>⏳ Revoking...</>
                          ) : (
                            <><XCircle className="h-4 w-4 mr-1" /> Revoke</>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => copyToClipboard(delegation.proof || btoa(JSON.stringify(delegation)), `created-${delegation.id}`)}
                        className="flex items-center text-green-600 hover:text-green-800 text-sm"
                        title="Copy delegation proof to share"
                      >
                        {copiedField === `created-${delegation.id}` ? 
                          <><Check className="h-4 w-4 mr-1" /> Copied!</> : 
                          <><Copy className="h-4 w-4 mr-1" /> Copy</>
                        }
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Received Delegations */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Download className="h-6 w-6 text-accent-blue mr-3" />
            <h3 className="text-xl font-semibold font-heading text-dark">
              Delegations Received ({receivedDelegations.length})
            </h3>
          </div>
          {receivedDelegations.length > 0 && (
            <button
              onClick={handleDeleteReceivedDelegations}
              className="bg-storacha-red text-white px-3 py-1.5 rounded-lg hover:bg-storacha-red-dark flex items-center text-sm transition-colors"
              title="Delete all received delegations"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete All
            </button>
          )}
        </div>

        {receivedDelegations.length === 0 ? (
          <div className="text-center py-12 bg-neutral-50 rounded-xl border-2 border-dashed border-neutral-300">
            <Download className="mx-auto h-12 w-12 text-neutral-400 mb-4" />
            <h3 className="text-lg font-medium font-heading text-dark mb-2">No Delegations Received</h3>
            <p className="text-neutral-500 max-w-sm mx-auto">
              Import a delegation from another browser to gain upload capabilities.
              Ask someone with Storacha credentials to create a delegation for your DID.
            </p>
            {currentDID && (
              <div className="mt-4 p-3 bg-primary-50 rounded-xl max-w-md mx-auto">
                <p className="text-sm font-medium text-dark mb-2">Your DID (share this):</p>
                <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-primary-200">
                  <code className="text-xs text-storacha-red flex-1 truncate">
                    {currentDID}
                  </code>
                  <button
                    onClick={() => copyToClipboard(currentDID, 'current-did-empty')}
                    className="ml-2 text-storacha-red hover:text-storacha-red-dark transition-colors"
                  >
                    {copiedField === 'current-did-empty' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => setShowImportForm(true)}
              className="btn-primary mt-4"
            >
              <Download className="h-4 w-4 mr-2" />
              Import Delegation
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {receivedDelegations.map((delegation) => (
              <div key={delegation.id} className="border border-neutral-200 rounded-xl p-4 bg-gradient-to-r from-primary-50 to-accent-purple">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <Key className="h-5 w-5 text-storacha-red mr-2" />
                      <span className="font-semibold text-dark">Delegation Chain</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {delegation.format && (
                        <div className="bg-accent-purple text-accent-blue-dark text-xs px-2 py-1 rounded-lg font-medium" title="Import format">
                          {delegation.format}
                        </div>
                      )}
                      {(() => {
                        const status = delegationStatus[delegation.id]?.status ?? 'checking';
                        const label =
                          status === 'valid'
                            ? 'Active'
                            : status === 'revoked'
                            ? 'Revoked'
                            : status === 'expired'
                            ? 'Expired'
                            : status === 'invalid'
                            ? 'Invalid'
                            : 'Checking...';
                        const className =
                          status === 'valid'
                            ? 'bg-green-100 text-green-800'
                            : status === 'revoked'
                            ? 'bg-primary-100 text-storacha-red'
                            : status === 'expired'
                            ? 'bg-orange-100 text-orange-700'
                            : status === 'invalid'
                            ? 'bg-neutral-200 text-neutral-700'
                            : 'bg-yellow-100 text-yellow-800';
                        return (
                          <div
                            className={`${className} text-xs px-2 py-1 rounded-lg font-medium`}
                            title={delegationStatus[delegation.id]?.reason}
                          >
                            {label}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  
                  {/* Delegation Chain Visualization */}
                  <div className="bg-white rounded-xl p-3 border border-primary-200">
                    <div className="text-xs font-medium text-neutral-600 mb-2">DELEGATION FLOW:</div>
                    <div className="flex items-center space-x-2 text-sm">
                      <div className="flex items-center bg-accent-purple px-2 py-1 rounded-lg text-accent-blue-dark">
                        <User className="h-3 w-3 mr-1" />
                        <span className="font-medium">Issuer</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-neutral-400" />
                      <div className="flex items-center bg-primary-100 px-2 py-1 rounded-lg text-storacha-red">
                        <Shield className="h-3 w-3 mr-1" />
                        <span className="font-medium">You</span>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="text-xs">
                        <span className="font-medium text-neutral-600">From:</span>
                        <code className="ml-1 text-xs bg-accent-purple text-accent-blue-dark px-1 py-0.5 rounded">
                          {delegation.fromIssuer?.startsWith('did:key:')
                            ? `${delegation.fromIssuer.slice(0, 20)}...${delegation.fromIssuer.slice(-8)}`
                            : delegation.fromIssuer || 'Unknown Issuer'
                          }
                        </code>
                      </div>
                      <div className="text-xs">
                        <span className="font-medium text-neutral-600">To:</span>
                        <code className="ml-1 text-xs bg-primary-50 text-storacha-red px-1 py-0.5 rounded">
                          {delegation.toAudience?.startsWith('did:key:')
                            ? `${delegation.toAudience.slice(0, 20)}...${delegation.toAudience.slice(-8)}`
                            : delegation.toAudience || 'Unknown Audience'
                          }
                        </code>
                        {currentDID && delegation.toAudience !== currentDID && (
                          <div className="mt-1 text-xs text-red-600 font-medium">
                            ⚠️ DID Mismatch - delegation is for different credential
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Delegation Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 text-neutral-400 mr-2" />
                        <span className="font-medium text-neutral-600">Received:</span>
                        <span className="ml-1 text-dark">
                          {new Date(delegation.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 text-neutral-400 mr-2" />
                        <span className="font-medium text-neutral-600">Expires:</span>
                        {delegation.expiresAt ? (
                          <span className={`ml-1 ${
                            new Date(delegation.expiresAt) < new Date() 
                              ? 'text-red-600 font-semibold' 
                              : new Date(delegation.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000
                              ? 'text-orange-600'
                              : 'text-dark'
                          }`}>
                            {new Date(delegation.expiresAt).toLocaleDateString()} {new Date(delegation.expiresAt).toLocaleTimeString()}
                            {new Date(delegation.expiresAt) < new Date() && ' (Expired)'}
                          </span>
                        ) : (
                          <span className="ml-1 text-green-600 font-medium">
                            Never (valid forever)
                          </span>
                        )}
                      </div>
                      
                      <div className="text-sm">
                        <span className="font-medium text-neutral-600">Delegation ID:</span>
                        <code className="ml-1 text-xs bg-neutral-100 text-neutral-700 px-1 py-0.5 rounded">
                          {delegation.id.length > 16 ? `${delegation.id.slice(0, 16)}...` : delegation.id}
                        </code>
                      </div>
                      
                      {delegation.format && (
                        <div className="text-sm">
                          <span className="font-medium text-neutral-600">Import Format:</span>
                          <span className="ml-1 text-xs bg-accent-purple text-accent-blue-dark px-2 py-0.5 rounded-lg border border-accent-blue">
                            {delegation.format}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <div className="text-sm font-medium text-neutral-600 mb-1">Capabilities:</div>
                      <div className="flex flex-wrap gap-1">
                        {(delegation.capabilities || []).map((cap, index) => (
                          <span key={index} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-primary-200">
                    <div className="text-xs text-neutral-500">
                      This delegation allows you to upload files using another browser's permissions
                    </div>
                    <div className="flex items-center gap-3">
                      {delegationStatus[delegation.id]?.status === 'revoked' && (
                        <button
                          onClick={() => handleClearRevocationCache(delegation.id)}
                          className="flex items-center text-amber-700 hover:text-amber-800 text-sm transition-colors"
                          title="Clear cached revocation status for this delegation"
                        >
                          🧹 Clear Revocation Cache
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteReceivedDelegation(delegation.id)}
                        className="flex items-center text-storacha-red hover:text-storacha-red-dark text-sm transition-colors"
                        title="Delete this received delegation"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </button>
                      <button
                        onClick={() => copyToClipboard(delegation.proof, `received-${delegation.id}`)}
                        className="flex items-center text-accent-blue hover:text-accent-blue-dark text-sm transition-colors"
                        title="Copy delegation proof"
                      >
                        {copiedField === `received-${delegation.id}` ?
                          <><Check className="h-4 w-4 mr-1" /> Copied!</> :
                          <><Copy className="h-4 w-4 mr-1" /> Copy Proof</>
                        }
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delegation Proof Modal */}
      {showDelegationProof && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card max-w-2xl w-full max-h-[80vh] overflow-y-auto animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold font-heading text-dark">
                🎉 Delegation Created Successfully!
              </h3>
              <button
                onClick={() => setShowDelegationProof(false)}
                className="text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-neutral-600">
                Copy this delegation proof and share it with the target browser:
              </p>

              {/* Debug info */}
              <div className="text-xs text-neutral-500">
                Debug: Proof length: {createdDelegationProof?.length || 0}
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Delegation Token
                </label>
                <div className="relative">
                  <textarea
                    value={createdDelegationProof || 'No delegation proof available'}
                    readOnly
                    className="input-field font-mono text-xs bg-neutral-50"
                    rows={8}
                    placeholder="Delegation proof will appear here..."
                  />
                  <button
                    onClick={() => copyToClipboard(createdDelegationProof, 'delegation-proof')}
                    className="absolute top-2 right-2 bg-storacha-red text-white px-3 py-1 rounded-lg text-sm hover:bg-storacha-red-dark flex items-center transition-colors"
                  >
                    {copiedField === 'delegation-proof' ? (
                      <><Check className="h-4 w-4 mr-1" /> Copied!</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-1" /> Copy</>
                    )}
                  </button>
                </div>
              </div>

              {uploadedDelegationCID && (
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">
                    Uploaded File CID
                  </label>
                  <div className="relative">
                    <textarea
                      value={uploadedDelegationCID}
                      readOnly
                      className="input-field font-mono text-xs bg-neutral-50"
                      rows={3}
                      placeholder="CID will appear here..."
                    />
                    <button
                      onClick={() => copyToClipboard(uploadedDelegationCID, 'delegation-cid')}
                      className="absolute top-2 right-2 bg-storacha-red text-white px-3 py-1 rounded-lg text-sm hover:bg-storacha-red-dark flex items-center transition-colors"
                    >
                      {copiedField === 'delegation-cid' ? (
                        <><Check className="h-4 w-4 mr-1" /> Copied!</>
                      ) : (
                        <><Copy className="h-4 w-4 mr-1" /> Copy</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-accent-purple border border-accent-blue rounded-xl p-4">
                <h4 className="font-medium text-dark mb-2">📋 Next Steps:</h4>
                <ol className="text-neutral-700 text-sm space-y-1 list-decimal list-inside">
                  <li>Copy the delegation proof above</li>
                  <li>Open the target browser (Browser B)</li>
                  <li>Go to the Delegations tab</li>
                  <li>Click \"Import Delegation\" and paste the proof</li>
                  <li>Browser B can now upload files using your permissions!</li>
                  {uploadedDelegationCID && (
                    <li className="mt-2 font-medium">
                      The delegation has been uploaded to Storacha with CID: {uploadedDelegationCID}
                    </li>
                  )}
                </ol>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setShowDelegationProof(false);
                    setUploadedDelegationCID(null);
                  }}
                  className="btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
