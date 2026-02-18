export interface FilecoinDeal {
  dealId: number;
  storageProvider: string;
  status: string;
}

export interface FilecoinStatus {
  piece?: string; // piece CID (commP)
  status: 'offered' | 'pending' | 'active' | 'unknown';
  deals?: FilecoinDeal[];
  lastChecked?: string;
}

export interface UploadedFile {
  id: string;
  cid: string;
  filename: string;
  size: number;
  uploadedAt: string;
  shards?: string[]; // shard CIDs
  piece?: string; // piece CID captured during upload
  filecoin?: FilecoinStatus;
}

export interface UploadResponse {
  ok: boolean;
  cid: string;
  shards?: string[];
  piece?: string; // piece CID from onShardStored
}

export interface UploadError {
  ok: false;
  error: string;
}
