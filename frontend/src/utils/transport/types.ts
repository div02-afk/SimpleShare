import type {
  TransferMetadata,
  TransferStatus,
  WriteMode,
} from "../../types/transfer";

export type TransportRole = "sender" | "receiver";

export interface OfferPayload {
  room: string;
  offer: RTCSessionDescriptionInit;
  connectionId: number;
}

export interface AnswerPayload {
  room: string;
  answer: RTCSessionDescriptionInit;
  connectionId: number;
}

export interface IceCandidatePayload {
  room: string;
  candidate: RTCIceCandidateInit;
  sender: TransportRole;
  connectionId: number;
}

export interface ReceiverReadyPayload {
  room: string;
  writeMode: WriteMode;
}

export interface ReceiverErrorPayload {
  room: string;
  error: string;
}

export interface RoomPayload {
  room: string;
}

export interface ReceivedPayload {
  room: string;
  data: number;
}

export interface ClientToServerEvents {
  "join-room": (room: string) => void;
  offer: (payload: OfferPayload) => void;
  answer: (payload: AnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  metadata: (payload: TransferMetadata) => void;
  "receiver-ready": (payload: ReceiverReadyPayload) => void;
  "receiver-error": (payload: ReceiverErrorPayload) => void;
  "receiver-finalizing": (payload: RoomPayload) => void;
  "transfer-complete": (payload: RoomPayload) => void;
  received: (payload: ReceivedPayload) => void;
}

export interface ServerToClientEvents {
  offer: (payload: OfferPayload) => void;
  answer: (payload: AnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  metadata: (payload: TransferMetadata) => void;
  "receiver-ready": (payload: ReceiverReadyPayload) => void;
  "receiver-error": (payload: ReceiverErrorPayload) => void;
  "receiver-finalizing": (payload: RoomPayload) => void;
  "transfer-complete": (payload: RoomPayload) => void;
  received: (bytesReceived: number) => void;
  "room-full": () => void;
  disconnect: () => void;
}

export interface TransferStoreAdapter {
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
  updateTransfer: (payload: Partial<{
    bytesWritten: number;
    error: string | null;
    highestContiguousWrittenIndex: number;
    metadata: TransferMetadata | null;
    reorderBufferSize: number;
    resolvedFileName: string | null;
    sizeReceived: number;
    transferSize: number;
    transferStatus: TransferStatus;
    writeMode: WriteMode | null;
  }>) => void;
  resetTransfer: () => void;
}

export interface PeerMeshConfig {
  role: TransportRole;
  peerConnectionCount: number;
  dataChannelsPerConnection: number;
  dataChannelHighWaterMark: number;
  dataChannelLowWaterMark: number;
  totalBufferedHighWaterMark: number;
  totalBufferedLowWaterMark: number;
}

export interface PeerMeshDependencies {
  onIceCandidate: (
    candidate: RTCIceCandidateInit,
    connectionId: number,
    sender: TransportRole
  ) => void;
  onAllConnected: () => void;
  onDataChannelMessage?: (
    data: Blob | string | ArrayBuffer | ArrayBufferView,
    connectionId: number
  ) => void;
  peerConnectionFactory?: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface SignalingClientLike {
  fetchRoomId(): Promise<string>;
  joinRoom(roomId: string): void;
  emit<K extends keyof ClientToServerEvents>(
    event: K,
    ...args: Parameters<ClientToServerEvents[K]>
  ): void;
  on<K extends keyof ServerToClientEvents>(
    event: K,
    handler: ServerToClientEvents[K]
  ): () => void;
  isConnected(): boolean;
  dispose(): void;
}

export interface PeerMeshLike {
  readonly connectionCount: number;
  createOffer(connectionId: number): Promise<RTCSessionDescriptionInit>;
  acceptOffer(
    connectionId: number,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit>;
  applyAnswer(
    connectionId: number,
    answer: RTCSessionDescriptionInit
  ): Promise<void>;
  addIceCandidate(
    connectionId: number,
    candidate: RTCIceCandidateInit
  ): Promise<void>;
  sendFrame(frame: ArrayBuffer, payloadBytes: number): Promise<void>;
  waitForGlobalDrain(): Promise<void>;
  noteBytesAcknowledged(bytesAcknowledged: number): void;
  dispose(error?: Error): void;
}

export interface TransportConfig {
  chunkSize: number;
  peerConnectionCount: number;
  dataChannelsPerConnection: number;
  dataChannelHighWaterMark: number;
  dataChannelLowWaterMark: number;
  totalBufferedHighWaterMark: number;
  totalBufferedLowWaterMark: number;
  receiverReadyTimeoutMs: number;
}

export interface DataFrameMessage {
  type: "data";
  index: number;
  byteLength: number;
  data: Uint8Array;
}

export interface CompleteFrameMessage {
  type: "complete";
  totalChunks: number;
}

export type TransferFrameMessage = DataFrameMessage | CompleteFrameMessage;

export interface TransferWriter {
  readonly writeMode: WriteMode;
  prepare(metadata: TransferMetadata): Promise<string | null>;
  writeChunk(chunk: Uint8Array): Promise<void>;
  finalize(metadata: TransferMetadata, resolvedFileName: string | null): Promise<number>;
  abort(): Promise<void>;
}
