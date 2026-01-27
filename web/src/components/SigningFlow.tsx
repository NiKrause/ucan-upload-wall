import React, { useState, useEffect } from 'react';
import { QRCodeGenerator } from './QRCodeGenerator';
import { QRCodeScanner } from './QRCodeScanner';
import { p2pClient } from '../lib/p2p-client';
import { 
  SigningRequest, 
  SigningResponse, 
  encodeSigningRequest, 
  decodeSigningRequest, 
  uint8ArrayToBase64,
  base64ToUint8Array 
} from '../lib/signing-flow';
import { WebAuthnDIDProvider } from '../lib/webauthn-did';

type FlowState = 'idle' | 'generating' | 'waiting' | 'scanning' | 'reviewing' | 'signing' | 'completed' | 'error';

interface SigningFlowProps {
  dataToSign?: Uint8Array;
  onSuccess?: (signature: Uint8Array) => void;
  onCancel?: () => void;
}

export const SigningFlow: React.FC<SigningFlowProps> = ({ 
  dataToSign = new TextEncoder().encode("Hello UCAN!"), 
  onSuccess, 
  onCancel 
}) => {
  const [state, setState] = useState<FlowState>('idle');
  const [request, setRequest] = useState<SigningRequest | null>(null);
  const [qrValue, setQrValue] = useState<string>('');
  const [scannedRequest, setScannedRequest] = useState<SigningRequest | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [signature, setSignature] = useState<string>('');

  useEffect(() => {
    return () => {
    };
  }, []);

  const startSigningRequest = async () => {
    try {
      setState('generating');
      setStatusMessage('Initializing P2P and generating request...');

      // 1. Initialize P2P
      await p2pClient.init();
      const peerId = p2pClient.getPeerId();

      // 2. Create Request
      const reqId = crypto.randomUUID();
      const newRequest: SigningRequest = {
        requestId: reqId,
        timestamp: new Date().toISOString(),
        data: uint8ArrayToBase64(dataToSign),
        requesterDID: `did:p2p:${peerId}`, 
        pwaUrl: window.location.origin,
        p2pAddress: peerId, 
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      };

      setRequest(newRequest);
      
      // 3. Generate QR Payload (URL)
      const encodedReq = encodeSigningRequest(newRequest);
      const url = new URL(window.location.origin);
      url.searchParams.set('action', 'sign');
      url.searchParams.set('request', encodedReq);
      setQrValue(url.toString());

      // 4. Subscribe to response topic
      const responseTopic = `resp-${reqId}`;
      await p2pClient.subscribe(responseTopic, (data) => {
        try {
          const responseStr = new TextDecoder().decode(data);
          const response: SigningResponse = JSON.parse(responseStr);
          if (response.requestId === reqId) {
            console.log('Received signature:', response.signature);
            setSignature(response.signature);
            setState('completed');
            if (onSuccess) {
              onSuccess(base64ToUint8Array(response.signature));
            }
          }
        } catch (e) {
          console.error('Failed to parse response', e);
        }
      });

      setState('waiting');
      setStatusMessage('Waiting for mobile device to scan...');
    } catch (e) {
      console.error(e);
      setState('error');
      setStatusMessage('Failed to start signing request');
    }
  };

  const handleScan = (decodedText: string) => {
    try {
      let reqStr = decodedText;
      try {
        const url = new URL(decodedText);
        const param = url.searchParams.get('request');
        if (param) {
          reqStr = param;
        }
      } catch (e) {
      }

      const req = decodeSigningRequest(reqStr);
      setScannedRequest(req);
      setState('reviewing');
      
      // Connect P2P
      p2pClient.init().then(() => {
         console.log('P2P initialized for signer');
      });

    } catch (e) {
      console.error('Invalid QR code', e);
    }
  };

  const approveSigning = async () => {
    if (!scannedRequest) return;

    try {
      setState('signing');
      setStatusMessage('Authenticating...');

      // 1. Biometric Authentication
      const isAvailable = await WebAuthnDIDProvider.isPlatformAuthenticatorAvailable();
      if (isAvailable) {
         try {
             
             // Trigger auth prompt
             await WebAuthnDIDProvider.getOrCreateCredential(); 
         } catch (e) {
             throw new Error("Authentication failed");
         }
      } else {
          // Fallback or dev mode
          if (!confirm("Biometrics not available. Approve signing?")) {
              throw new Error("User rejected");
          }
      }

      // 2. Sign
      // Mock signature for now as we don't have the DKG share logic fully connected
      const mockSignature = `sig-by-${p2pClient.getPeerId()}-for-${scannedRequest.requestId}`;
      
      const response: SigningResponse = {
        requestId: scannedRequest.requestId,
        signature: uint8ArrayToBase64(new TextEncoder().encode(mockSignature)),
        approverDID: `did:p2p:${p2pClient.getPeerId()}`
      };

      // 3. Send Response
      const responseTopic = `resp-${scannedRequest.requestId}`;
      await p2pClient.publish(responseTopic, new TextEncoder().encode(JSON.stringify(response)));

      setState('completed');
      setStatusMessage('Signed successfully! Check the browser.');

    } catch (e) {
      console.error(e);
      setState('error');
      setStatusMessage('Signing failed or rejected.');
    }
  };

  // Check for URL params on mount (if opened via QR scan)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestParam = params.get('request');
    const action = params.get('action');

    if (action === 'sign' && requestParam) {
      try {
        const req = decodeSigningRequest(requestParam);
        setScannedRequest(req);
        setState('reviewing');
      } catch (e) {
        console.error('Failed to parse request from URL', e);
      }
    }
  }, []);

  return (
    <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Multi-Device Signing</h2>
      
      {state === 'idle' && (
        <div className="flex gap-4 justify-center">
          <button 
            onClick={startSigningRequest}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Start Signing Request
          </button>
          <button 
            onClick={() => setState('scanning')}
            className="px-6 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 font-medium"
          >
            Scan QR Code
          </button>
        </div>
      )}

      {state === 'generating' && (
        <div className="text-center py-8">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">{statusMessage}</p>
        </div>
      )}

      {state === 'waiting' && request && (
        <div className="text-center">
          <p className="mb-4 text-gray-600">Scan this code with your mobile device:</p>
          <div className="mb-6 flex justify-center">
            <QRCodeGenerator value={qrValue} size={300} />
          </div>
          <p className="text-xs text-gray-400 break-all px-8 mb-4">{qrValue}</p>
          <p className="text-sm text-blue-600 animate-pulse">Waiting for signature...</p>
          <button 
            onClick={() => {
              if (onCancel) onCancel();
              else setState('idle');
            }}
            className="mt-6 text-gray-500 hover:text-gray-700 underline"
          >
            Cancel
          </button>
        </div>
      )}

      {state === 'scanning' && (
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-4">Scan Signing Request</h3>
          <QRCodeScanner onScan={handleScan} />
          <button 
            onClick={() => setState('idle')}
            className="mt-4 text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {state === 'reviewing' && scannedRequest && (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <h3 className="text-xl font-bold mb-4 text-gray-800">Review Signing Request</h3>
          <div className="space-y-3 mb-6 text-left">
            <div>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Requester</span>
              <p className="font-mono text-sm break-all">{scannedRequest.requesterDID}</p>
            </div>
            <div>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Timestamp</span>
              <p className="text-sm">{new Date(scannedRequest.timestamp).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Data Hash/Preview</span>
              <div className="bg-gray-100 p-2 rounded text-xs font-mono break-all mt-1">
                {scannedRequest.data.substring(0, 50)}...
              </div>
            </div>
          </div>
          
          <div className="flex gap-3">
            <button 
              onClick={approveSigning}
              className="flex-1 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-sm flex items-center justify-center gap-2"
            >
              <span>✋</span> Authenticate & Sign
            </button>
            <button 
              onClick={() => setState('idle')}
              className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {state === 'signing' && (
        <div className="text-center py-8">
           <div className="animate-spin h-8 w-8 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-4"></div>
           <p className="text-gray-600">{statusMessage}</p>
        </div>
      )}

      {state === 'completed' && (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
            ✓
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">Signing Complete!</h3>
          <p className="text-gray-600 mb-6">The secure handshake was successful.</p>
          {signature && (
              <div className="mb-6 text-left bg-gray-100 p-3 rounded overflow-hidden">
                  <p className="text-xs text-gray-500 mb-1">Signature:</p>
                  <p className="font-mono text-xs break-all">{signature}</p>
              </div>
          )}
          <button 
            onClick={() => {
                setState('idle');
                setScannedRequest(null);
                setRequest(null);
                setSignature('');
            }}
            className="px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
          >
            Done
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
            !
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">Error</h3>
          <p className="text-red-600 mb-6">{statusMessage}</p>
          <button 
            onClick={() => setState('idle')}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
};
