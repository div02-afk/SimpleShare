import type {
  ConnectionStage,
  CompressionMode,
  PeerStatus,
  SignalingStatus,
  TransferMetadata,
  TransferStatus,
  TransportRole,
  WriteMode,
} from "../../types/transfer";

export type ChunkEncoding = "raw" | "deflate";
export type JoinRejectedReason =
  | "sender-not-found"
  | "duplicate-role"
  | "room-full";
export type PeerTransportState = Exclude<PeerStatus, "waiting">;

export interface JoinRoomPayload {
  room: string;
  role: TransportRole;
}

export interface RoomPayload {
  room: string;
}

export interface JoinRejectedPayload extends RoomPayload {
  reason: JoinRejectedReason;
}

export interface PeerLeftPayload extends RoomPayload {
  role: TransportRole;
}

export interface WebSocketPingPayload {
  sentAt: number;
}

export interface WebSocketPongPayload extends WebSocketPingPayload {
  serverTime: number;
}

export interface PeerTransportStatePayload extends RoomPayload {
  role: TransportRole;
  state: PeerTransportState;
}

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
  compressionMode?: CompressionMode;
}

export interface ReceiverErrorPayload {
  room: string;
  error: string;
}

export interface ReceivedPayload {
  room: string;
  logicalBytesReceived: number;
  wireBytesReceived: number;
}

export interface ClientToServerEvents {
  "join-room": (payload: JoinRoomPayload) => void;
  offer: (payload: OfferPayload) => void;
  answer: (payload: AnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  metadata: (payload: TransferMetadata) => void;
  "receiver-ready": (payload: ReceiverReadyPayload) => void;
  "receiver-error": (payload: ReceiverErrorPayload) => void;
  "receiver-finalizing": (payload: RoomPayload) => void;
  "transfer-complete": (payload: RoomPayload) => void;
  received: (payload: ReceivedPayload) => void;
  "ws-ping": (payload: WebSocketPingPayload) => void;
  "peer-transport-state": (payload: PeerTransportStatePayload) => void;
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
  received: (payload: ReceivedPayload) => void;
  "room-ready": (payload: RoomPayload) => void;
  "join-rejected": (payload: JoinRejectedPayload) => void;
  "peer-left": (payload: PeerLeftPayload) => void;
  "ws-pong": (payload: WebSocketPongPayload) => void;
  "peer-transport-state": (payload: PeerTransportStatePayload) => void;
  disconnect: () => void;
}

export interface TransferStoreAdapter {
  setConnected: (isConnected?: boolean) => void;
  setSignalingStatus: (signalingStatus: SignalingStatus) => void;
  setSignalingLatency: (signalingLatencyMs: number | null) => void;
  setPeerStatus: (peerStatus: PeerStatus) => void;
  setConnectionStage: (connectionStage: ConnectionStage) => void;
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

export interface RuntimeRtcConfiguration extends RTCConfiguration {
  sdpSemantics?: string;
}

export interface PeerMeshDependencies {
  onIceCandidate: (
    candidate: RTCIceCandidateInit,
    connectionId: number,
    sender: TransportRole
  ) => void;
  onAllConnected: () => void;
  onTransportStateChange?: (state: PeerStatus) => void;
  onDataChannelMessage?: (
    data: Blob | string | ArrayBuffer | ArrayBufferView,
    connectionId: number
  ) => void;
  peerConnectionFactory?: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface SignalingClientLike {
  fetchRoomId(): Promise<string>;
  fetchIceServers(): Promise<RTCIceServer[]>;
  joinRoom(payload: JoinRoomPayload): void;
  emit<K extends keyof ClientToServerEvents>(
    event: K,
    ...args: Parameters<ClientToServerEvents[K]>
  ): void;
  on<K extends keyof ServerToClientEvents>(
    event: K,
    handler: ServerToClientEvents[K]
  ): () => void;
  onSignalingStatusChange(handler: (status: SignalingStatus) => void): () => void;
  onLatencyChange(handler: (latencyMs: number | null) => void): () => void;
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
  sendFrame(frame: ArrayBuffer, accountedWireBytes?: number): Promise<void>;
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
  encoding: ChunkEncoding;
  wireByteLength: number;
  originalByteLength: number;
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
