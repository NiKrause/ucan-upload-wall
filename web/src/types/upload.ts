export interface UploadedFile {
  id: string;
  cid: string;
  filename: string;
  size: number;
  uploadedAt: string;
}

export interface UploadResponse {
  ok: true;
  cid: string;
}

export interface UploadError {
  ok: false;
  error: string;
}

export type UploadResult = UploadResponse | UploadError;
