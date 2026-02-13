// Types shared between the main thread and the ed25519 keystore worker.

export interface KeystoreInitMessage {
  type: 'init';
  id: number;
  prfSeed: ArrayBuffer;
}

export interface KeystoreGenerateMessage {
  type: 'generateKeypair';
  id: number;
}

export interface KeystoreEncryptMessage {
  type: 'encrypt';
  id: number;
  plaintext: ArrayBuffer;
}

export interface KeystoreDecryptMessage {
  type: 'decrypt';
  id: number;
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
}

export interface KeystoreSignMessage {
  type: 'sign';
  id: number;
  data: ArrayBuffer;
}

export interface KeystoreVerifyMessage {
  type: 'verify';
  id: number;
  data: ArrayBuffer;
  signature: ArrayBuffer;
}

export type KeystoreRequestMessage =
  | KeystoreInitMessage
  | KeystoreGenerateMessage
  | KeystoreEncryptMessage
  | KeystoreDecryptMessage
  | KeystoreSignMessage
  | KeystoreVerifyMessage;

export interface KeystoreSuccessResponse {
  id: number;
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

export interface KeystoreErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export type KeystoreResponseMessage = KeystoreSuccessResponse | KeystoreErrorResponse;

