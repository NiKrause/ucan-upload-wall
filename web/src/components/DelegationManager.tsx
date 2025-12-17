import { useState, useEffect, useCallback } from 'react';
import { Share, Copy, Check, Plus, Download, Upload, Shield, Trash2, ArrowRight, User, Clock, Key } from 'lucide-react';
import { UCANDelegationService, DelegationInfo } from '../lib/ucan-delegation';

interface DelegationManagerProps {
  delegationService: UCANDelegationService;
  onDidCreated?: () => void;
}

export function DelegationManager({ delegationService }: DelegationManagerProps) {
  const [currentDID, setCurrentDID] = useState<string | null>(null);
  const [createdDelegations, setCreatedDelegations] = useState<DelegationInfo[]>([]);
  const [receivedDelegations, setReceivedDelegations] = useState<DelegationInfo[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [targetDID, setTargetDID] = useState('');
  const [importProof, setImportProof] = useState('');
  const [delegationName, setDelegationName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showDelegationProof, setShowDelegationProof] = useState(false);
  const [createdDelegationProof, setCreatedDelegationProof] = useState('');
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
      
      loadData();
      setShowCreateForm(false);
      setTargetDID('');
      
      // Show the created delegation proof in modal
      if (delegationProof && delegationProof.length > 0) {
        setCreatedDelegationProof(delegationProof);
        setShowDelegationProof(true);
        console.log('📋 Modal state set - showing delegation proof');
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

  const handleImportDelegation = async () => {
    if (!importProof) {
      alert('Please paste a delegation proof');
      return;
    }

    try {
      await delegationService.importDelegation(importProof, delegationName || undefined);
      loadData();
      const delegations = delegationService.getReceivedDelegations();
      const latestDelegation = delegations[0]; // Most recently added
      setShowImportForm(false);
      setImportProof('');
      setDelegationName(''); // Clear the name field
      
      // Show format in success message
      const formatInfo = latestDelegation?.format ? `\n\nFormat detected: ${latestDelegation.format}` : '';
      alert(`Delegation imported successfully!${formatInfo}`);
    } catch (error) {
      alert(`Failed to import delegation: ${error}`);
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

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-3">
          Setup Your Ed25519 DID & Upload Access
        </h2>
        <p className="text-gray-600">
          Import a UCAN delegation token to get upload access, or add Storacha credentials directly
        </p>
      </div>

      {/* Current Ed25519 DID - Most Important! */}
      {currentDID && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-300 rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center flex-1">
              <Shield className="h-6 w-6 text-blue-600 mr-3" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-blue-900 mb-1">Your Ed25519 DID</h3>
                <p className="text-sm text-blue-700 mb-2">Share this DID to receive UCAN delegations from Storacha CLI</p>
                <code className="text-sm text-blue-800 break-all bg-white/60 px-3 py-2 rounded border border-blue-200 block">{currentDID}</code>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(currentDID, 'current-did')}
              className="ml-4 flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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

      {/* Primary Action: Import UCAN Token */}
      <div className="bg-white rounded-lg border-2 border-green-300 p-6 shadow-sm">
        <div className="flex items-center mb-4">
          <Download className="h-6 w-6 text-green-600 mr-3" />
          <div>
            <h3 className="text-xl font-bold text-gray-900">Import UCAN Delegation Token</h3>
            <p className="text-sm text-gray-600">Recommended: Paste your UCAN token to get upload access</p>
          </div>
        </div>
        
        {receivedDelegations.length > 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-green-800 text-sm font-medium">
              ✓ You have {receivedDelegations.length} active UCAN delegation(s). You can upload files!
            </p>
          </div>
        ) : null}
        
        <button
          onClick={() => setShowImportForm(!showImportForm)}
          className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 flex items-center font-medium"
        >
          <Download className="h-5 w-5 mr-2" />
          {showImportForm ? 'Hide Import Form' : 'Import UCAN Token'}
        </button>
      </div>

      {/* Secondary Option: Storacha Credentials */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Key className="h-6 w-6 text-purple-500 mr-3" />
            <div>
              <h3 className="text-xl font-semibold text-gray-900">
                Storacha Credentials (Alternative)
              </h3>
              <p className="text-sm text-gray-600">Advanced: Add credentials directly if you have a Storacha account</p>
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
              className="text-purple-600 hover:text-purple-700 text-sm font-medium"
            >
              {showCredentialsForm ? 'Hide' : 'Add Credentials'}
            </button>
          )}
        </div>

        {savedCredentials ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800 text-sm">
              ✓ Storacha credentials configured. You can now create delegations and upload files.
            </p>
            <button
              onClick={() => {
                setSavedCredentials(false);
                setShowCredentialsForm(true);
              }}
              className="mt-2 text-sm text-green-700 hover:text-green-900 underline"
            >
              Update credentials
            </button>
          </div>
        ) : (
          <>
            <p className="text-gray-600 text-sm mb-4">
              Add Storacha space credentials to enable file uploads and delegation creation. Required if you didn't get a UCAN delegation from another person or device!
            </p>
            
            {showCredentialsForm && (
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
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Delegation (show if user has credentials OR received delegations for chaining) */}
      {(savedCredentials || receivedDelegations.length > 0) && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center mb-4">
            <Share className="h-6 w-6 text-purple-600 mr-3" />
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Create Delegation for Others</h3>
              <p className="text-sm text-gray-600">
                {savedCredentials 
                  ? 'Share upload access with other DIDs using your Storacha credentials'
                  : 'Chain your UCAN delegation - share access with other DIDs'}
              </p>
            </div>
          </div>
          
          {!savedCredentials && receivedDelegations.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-blue-800 text-sm">
                <strong>🔗 UCAN Chaining:</strong> You can re-delegate your received UCAN to another DID. This creates a delegation chain.
              </p>
            </div>
          )}
          
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 flex items-center font-medium"
          >
            <Plus className="h-5 w-5 mr-2" />
            {showCreateForm ? 'Hide Form' : 'Create New Delegation'}
          </button>
        </div>
      )}

      {/* Create Delegation Form */}
      {showCreateForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            Create New Delegation
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target DID (from another browser)
              </label>
              <input
                type="text"
                value={targetDID}
                onChange={(e) => setTargetDID(e.target.value)}
                placeholder="did:key:..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Delegation Expiration
              </label>
              <select
                value={expirationHours ?? 'never'}
                onChange={(e) => setExpirationHours(e.target.value === 'never' ? null : Number(e.target.value))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
              <p className="text-xs text-gray-500 mt-1">
                {expirationHours === null 
                  ? 'This delegation will never expire' 
                  : 'The delegation will expire after this time period'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Select Capabilities to Delegate
              </label>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Group capabilities by category */}
                {['Upload', 'List', 'Delete', 'Store'].map(category => {
                  const categoryCapabilities = availableCapabilities.filter(cap => cap.category === category);
                  if (categoryCapabilities.length === 0) return null;
                  
                  return (
                    <div key={category} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
                      <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                        {category === 'Upload' && <Upload className="h-4 w-4 mr-2 text-green-600" />}
                        {category === 'List' && <ArrowRight className="h-4 w-4 mr-2 text-blue-600" />}
                        {category === 'Delete' && <Trash2 className="h-4 w-4 mr-2 text-red-600" />}
                        {category === 'Store' && <Shield className="h-4 w-4 mr-2 text-purple-600" />}
                        {category} Capabilities
                      </h4>
                      
                      <div className="space-y-2">
                        {categoryCapabilities.map(capability => (
                          <label key={capability.id} className="flex items-start space-x-3 cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors">
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
                              className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900">{capability.label}</div>
                              <div className="text-xs text-gray-500">{capability.description}</div>
                              <code className="text-xs text-gray-400 bg-gray-100 px-1 py-0.5 rounded break-all">{capability.id}</code>
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
                  className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                >
                  Basic Upload
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities(['space/blob/add', 'upload/add', 'upload/list'])}
                  className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200"
                >
                  Recommended
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities(availableCapabilities.map(cap => cap.id))}
                  className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200"
                >
                  All Capabilities
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCapabilities([])}
                  className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Clear All
                </button>
              </div>
              
              <div className="text-xs text-gray-500 mt-2">
                Selected: {selectedCapabilities.length} capability(ies)
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleCreateDelegation}
                disabled={isCreating}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                <Share className="h-4 w-4 mr-2" />
                {isCreating ? 'Creating...' : 'Create Delegation'}
              </button>
              
              <button
                onClick={() => setShowCreateForm(false)}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import UCAN Token Form */}
      {showImportForm && (
        <div className="bg-white rounded-lg border-2 border-green-300 p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Import UCAN Delegation Token
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Paste the base64 UCAN token that was delegated to your Ed25519 DID
          </p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Delegation Name (Optional)
              </label>
              <input
                type="text"
                value={delegationName}
                onChange={(e) => setDelegationName(e.target.value)}
                placeholder="e.g., Alice's Upload Token, Work Laptop, etc."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                💡 Give this delegation a friendly name to remember where it came from
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                UCAN Token (Base64)
              </label>
              <textarea
                value={importProof}
                onChange={(e) => setImportProof(e.target.value)}
                placeholder="Paste your base64 UCAN token here...\n\nExample: mAYIEAKMYOqJlcm9vdHO..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                rows={6}
              />
              <p className="text-xs text-gray-500 mt-2">
                💡 Get this token from `storacha delegation create YOUR_DID --base64`
              </p>
              
              <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-xs text-blue-800">
                  <strong>✓ Auto-detects format:</strong> Supports Storacha CLI (multibase-base64 with 'm' prefix), 
                  base64url ('u' prefix), CAR files, and legacy JSON formats. The detected format will be displayed after import.
                </div>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleImportDelegation}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 flex items-center font-medium"
              >
                <Download className="h-5 w-5 mr-2" />
                Import UCAN Token
              </button>
              
              <button
                onClick={() => setShowImportForm(false)}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Created Delegations */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Upload className="h-6 w-6 text-green-500 mr-3" />
            <h3 className="text-xl font-semibold text-gray-900">
              Delegations Created ({createdDelegations.length})
            </h3>
          </div>
          {createdDelegations.length > 0 && (
            <button
              onClick={handleDeleteCreatedDelegations}
              className="bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 flex items-center text-sm"
              title="Delete all created delegations"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete All
            </button>
          )}
        </div>

        {createdDelegations.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <Share className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Delegations Created</h3>
            <p className="text-gray-500 max-w-sm mx-auto">
              Create a delegation to share your upload capabilities with another browser. 
              This allows others to upload files using your Storacha credentials.
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-4 inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Delegation
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {createdDelegations.map((delegation) => (
              <div key={delegation.id} className="border border-gray-200 rounded-lg p-4 bg-gradient-to-r from-green-50 to-emerald-50">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <Share className="h-5 w-5 text-green-600 mr-2" />
                      <span className="font-semibold text-gray-900">Delegation Created</span>
                    </div>
                    <div className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded font-medium">
                      Shared
                    </div>
                  </div>
                  
                  {/* Delegation Chain Visualization */}
                  <div className="bg-white rounded-lg p-3 border border-green-200">
                    <div className="text-xs font-medium text-gray-600 mb-2">DELEGATION FLOW:</div>
                    <div className="flex items-center space-x-2 text-sm">
                      <div className="flex items-center bg-green-100 px-2 py-1 rounded text-green-800">
                        <Shield className="h-3 w-3 mr-1" />
                        <span className="font-medium">You</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-400" />
                      <div className="flex items-center bg-orange-100 px-2 py-1 rounded text-orange-800">
                        <User className="h-3 w-3 mr-1" />
                        <span className="font-medium">Recipient</span>
                      </div>
                    </div>
                    
                    <div className="mt-3 space-y-2">
                      <div className="text-xs">
                        <span className="font-medium text-gray-600">From:</span>
                        <code className="ml-1 text-xs bg-green-50 text-green-700 px-1 py-0.5 rounded">
                          {delegation.fromIssuer?.startsWith('did:key:') 
                            ? `${delegation.fromIssuer.slice(0, 20)}...${delegation.fromIssuer.slice(-8)}`
                            : delegation.fromIssuer || currentDID || 'Your DID'
                          }
                        </code>
                      </div>
                      <div className="text-xs">
                        <span className="font-medium text-gray-600">To:</span>
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
                        <Clock className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="font-medium text-gray-600">Created:</span>
                        <span className="ml-1 text-gray-900">
                          {new Date(delegation.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="font-medium text-gray-600">Expires:</span>
                        {delegation.expiresAt ? (
                          <span className={`ml-1 ${
                            new Date(delegation.expiresAt) < new Date() 
                              ? 'text-red-600 font-semibold' 
                              : new Date(delegation.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000
                              ? 'text-orange-600'
                              : 'text-gray-900'
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
                        <span className="font-medium text-gray-600">Delegation ID:</span>
                        <code className="ml-1 text-xs bg-gray-100 text-gray-700 px-1 py-0.5 rounded">
                          {delegation.id.length > 16 ? `${delegation.id.slice(0, 16)}...` : delegation.id}
                        </code>
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-1">Capabilities Granted:</div>
                      <div className="flex flex-wrap gap-1">
                        {delegation.capabilities.map((cap, index) => (
                          <span key={index} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-green-200">
                    <div className="text-xs text-gray-500">
                      Share this delegation proof with the recipient to grant them upload permissions
                    </div>
                    <button
                      onClick={() => copyToClipboard(delegation.proof || btoa(JSON.stringify(delegation)), `created-${delegation.id}`)}
                      className="flex items-center text-green-600 hover:text-green-800 text-sm"
                      title="Copy delegation proof to share"
                    >
                      {copiedField === `created-${delegation.id}` ? 
                        <><Check className="h-4 w-4 mr-1" /> Copied!</> : 
                        <><Copy className="h-4 w-4 mr-1" /> Copy to Share</>
                      }
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Received Delegations */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Download className="h-6 w-6 text-blue-500 mr-3" />
            <h3 className="text-xl font-semibold text-gray-900">
              Delegations Received ({receivedDelegations.length})
            </h3>
          </div>
          {receivedDelegations.length > 0 && (
            <button
              onClick={handleDeleteReceivedDelegations}
              className="bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 flex items-center text-sm"
              title="Delete all received delegations"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete All
            </button>
          )}
        </div>

        {receivedDelegations.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <Download className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Delegations Received</h3>
            <p className="text-gray-500 max-w-sm mx-auto">
              Import a delegation from another browser to gain upload capabilities. 
              Ask someone with Storacha credentials to create a delegation for your DID.
            </p>
            {currentDID && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg max-w-md mx-auto">
                <p className="text-sm font-medium text-blue-900 mb-2">Your DID (share this):</p>
                <div className="flex items-center justify-between bg-white p-2 rounded border">
                  <code className="text-xs text-blue-700 flex-1 truncate">
                    {currentDID}
                  </code>
                  <button
                    onClick={() => copyToClipboard(currentDID, 'current-did-empty')}
                    className="ml-2 text-blue-600 hover:text-blue-800"
                  >
                    {copiedField === 'current-did-empty' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => setShowImportForm(true)}
              className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Download className="h-4 w-4 mr-2" />
              Import Delegation
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {receivedDelegations.map((delegation) => (
              <div key={delegation.id} className="border border-gray-200 rounded-lg p-4 bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <Key className="h-5 w-5 text-blue-600 mr-2" />
                      <span className="font-semibold text-gray-900">Delegation Chain</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {delegation.format && (
                        <div className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded font-medium" title="Import format">
                          {delegation.format}
                        </div>
                      )}
                    <div className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-medium">
                      Active
                      </div>
                    </div>
                  </div>
                  
                  {/* Delegation Chain Visualization */}
                  <div className="bg-white rounded-lg p-3 border border-blue-200">
                    <div className="text-xs font-medium text-gray-600 mb-2">DELEGATION FLOW:</div>
                    <div className="flex items-center space-x-2 text-sm">
                      <div className="flex items-center bg-purple-100 px-2 py-1 rounded text-purple-800">
                        <User className="h-3 w-3 mr-1" />
                        <span className="font-medium">Issuer</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-400" />
                      <div className="flex items-center bg-blue-100 px-2 py-1 rounded text-blue-800">
                        <Shield className="h-3 w-3 mr-1" />
                        <span className="font-medium">You</span>
                      </div>
                    </div>
                    
                    <div className="mt-3 space-y-2">
                      <div className="text-xs">
                        <span className="font-medium text-gray-600">From:</span>
                        <code className="ml-1 text-xs bg-purple-50 text-purple-700 px-1 py-0.5 rounded">
                          {delegation.fromIssuer?.startsWith('did:key:') 
                            ? `${delegation.fromIssuer.slice(0, 20)}...${delegation.fromIssuer.slice(-8)}`
                            : delegation.fromIssuer || 'Unknown Issuer'
                          }
                        </code>
                      </div>
                      <div className="text-xs">
                        <span className="font-medium text-gray-600">To:</span>
                        <code className="ml-1 text-xs bg-blue-50 text-blue-700 px-1 py-0.5 rounded">
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
                        <Clock className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="font-medium text-gray-600">Received:</span>
                        <span className="ml-1 text-gray-900">
                          {new Date(delegation.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div className="flex items-center text-sm">
                        <Clock className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="font-medium text-gray-600">Expires:</span>
                        {delegation.expiresAt ? (
                          <span className={`ml-1 ${
                            new Date(delegation.expiresAt) < new Date() 
                              ? 'text-red-600 font-semibold' 
                              : new Date(delegation.expiresAt).getTime() - Date.now() < 24 * 60 * 60 * 1000
                              ? 'text-orange-600'
                              : 'text-gray-900'
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
                        <span className="font-medium text-gray-600">Delegation ID:</span>
                        <code className="ml-1 text-xs bg-gray-100 text-gray-700 px-1 py-0.5 rounded">
                          {delegation.id.length > 16 ? `${delegation.id.slice(0, 16)}...` : delegation.id}
                        </code>
                      </div>
                      
                      {delegation.format && (
                        <div className="text-sm">
                          <span className="font-medium text-gray-600">Import Format:</span>
                          <span className="ml-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                            {delegation.format}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-1">Capabilities:</div>
                      <div className="flex flex-wrap gap-1">
                        {delegation.capabilities.map((cap, index) => (
                          <span key={index} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-blue-200">
                    <div className="text-xs text-gray-500">
                      This delegation allows you to upload files using another browser's permissions
                    </div>
                    <button
                      onClick={() => copyToClipboard(delegation.proof, `received-${delegation.id}`)}
                      className="flex items-center text-blue-600 hover:text-blue-800 text-sm"
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
            ))}
          </div>
        )}
      </div>

      {/* Delegation Proof Modal */}
      {showDelegationProof && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  🎉 Delegation Created Successfully!
                </h3>
                <button
                  onClick={() => setShowDelegationProof(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-4">
                <p className="text-gray-600">
                  Copy this delegation proof and share it with the target browser:
                </p>
                
                {/* Debug info */}
                <div className="text-xs text-gray-500">
                  Debug: Proof length: {createdDelegationProof?.length || 0}
                </div>
                
                <div className="relative">
                  <textarea
                    value={createdDelegationProof || 'No delegation proof available'}
                    readOnly
                    className="w-full p-3 border border-gray-300 rounded-lg font-mono text-xs bg-gray-50"
                    rows={8}
                    placeholder="Delegation proof will appear here..."
                  />
                  <button
                    onClick={() => copyToClipboard(createdDelegationProof, 'delegation-proof')}
                    className="absolute top-2 right-2 bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 flex items-center"
                  >
                    {copiedField === 'delegation-proof' ? (
                      <><Check className="h-4 w-4 mr-1" /> Copied!</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-1" /> Copy</>
                    )}
                  </button>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">📋 Next Steps:</h4>
                  <ol className="text-blue-800 text-sm space-y-1 list-decimal list-inside">
                    <li>Copy the delegation proof above</li>
                    <li>Open the target browser (Browser B)</li>
                    <li>Go to the Delegations tab</li>
                    <li>Click "Import Delegation" and paste the proof</li>
                    <li>Browser B can now upload files using your permissions!</li>
                  </ol>
                </div>
                
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowDelegationProof(false)}
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
