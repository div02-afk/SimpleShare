export type TransferStatus =
  | "idle"
  | "awaiting-receiver"
  | "awaiting-save"
  | "streaming-direct-write"
  | "fallback-buffering"
  | "finalizing-write"
  | "completed"
  | "failed";

export type WriteMode = "stream" | "blob-fallback";

export type CompressionMode = "none" | "adaptive-deflate-v1";

export interface TransferMetadata {
  room: string;
  type: string;
  size: number;
  name: string;
  chunkSize: number;
  totalChunks: number;
  compressionMode?: CompressionMode;
}

export interface TransferState {
  isConnected: boolean;
  sizeReceived: number;
  bytesWritten: number;
  transferSize: number;
  metadata: TransferMetadata | null;
  transferStatus: TransferStatus;
  writeMode: WriteMode | null;
  error: string | null;
  resolvedFileName: string | null;
  reorderBufferSize: number;
  highestContiguousWrittenIndex: number;
}

export interface TransferActions {
  setConnected: (isConnected?: boolean) => void;
  setMetadata: (metadata: TransferMetadata | null) => void;
  setSizeReceived: (sizeReceived: number) => void;
  setBytesWritten: (bytesWritten: number) => void;
  setTransferStatus: (transferStatus: TransferStatus) => void;
  setWriteMode: (writeMode: WriteMode | null) => void;
  setTransferError: (error: string | null) => void;
  setResolvedFileName: (resolvedFileName: string | null) => void;
  setTransferSize: (transferSize: number) => void;
  setReorderMetrics: (
    reorderBufferSize: number,
    highestContiguousWrittenIndex: number
  ) => void;
  markReceiveStarted: () => void;
  updateTransfer: (payload: Partial<TransferState>) => void;
  resetTransfer: () => void;
}

export type TransferStore = TransferState & TransferActions;
