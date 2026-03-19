import type {
  CompressionMode,
  PeerStatus,
  WriteMode,
} from "../../types/transfer";
import posthog from "posthog-js";
import {
  DEFAULT_COMPRESSION_MODE,
  FflateCompressionAdapter,
  type CompressionAdapter,
  resolveCompressionMode,
} from "./compression";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_DATA_CHANNELS_PER_CONNECTION,
  DEFAULT_PEER_CONNECTION_COUNT,
  DEFAULT_RECEIVER_READY_TIMEOUT_MS,
  DATA_CHANNEL_HIGH_WATER_MARK,
  DATA_CHANNEL_LOW_WATER_MARK,
  PEER_RECOVERY_GRACE_PERIOD_MS,
  TOTAL_BUFFERED_HIGH_WATER_MARK,
  TOTAL_BUFFERED_LOW_WATER_MARK,
} from "./config";
import { getDataFrameByteLength, parseFrame } from "./frameProtocol";
import PeerMesh from "./peerMesh";
import {
  BlobFallbackWriter,
  StreamFileWriter,
  supportsDirectFileWrite,
} from "./receiverWriters";
import SignalingClient from "./signalingClient";
import type {
  JoinRejectedReason,
  PeerMeshLike,
  PeerTransportState,
  RuntimeRtcConfiguration,
  SignalingClientLike,
  TransferFrameMessage,
  TransferStoreAdapter,
  TransferWriter,
  TransportConfig,
} from "./types";
import type { TransferMetadata } from "../../types/transfer";

type ActiveReceiverStatus =
  | "idle"
  | "awaiting-save"
  | "streaming-direct-write"
  | "fallback-buffering"
  | "finalizing-write"
  | "completed"
  | "failed";

interface ReceiverTransferSession {
  metadata: TransferMetadata | null;
  writer: TransferWriter | null;
  resolvedFileName: string | null;
  nextChunkToWrite: number;
  pendingChunksByIndex: Map<number, Uint8Array>;
  receivedChunkCount: number;
  receivedBytes: number;
  receivedWireBytes: number;
  bytesWritten: number;
  expectedTotalChunks: number | null;
  completionReceived: boolean;
  finalized: boolean;
  transferStatus: ActiveReceiverStatus;
  writeMode: WriteMode | null;
  flushPromise: Promise<void>;
}

interface TimerApi {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

interface ReceiverSessionDependencies {
  createSignalingClient?: () => SignalingClientLike;
  createPeerMesh?: (
    config: TransportConfig,
    roomId: string,
    rtcConfiguration: RuntimeRtcConfiguration
  ) => PeerMeshLike;
  createStreamWriter?: () => TransferWriter;
  createFallbackWriter?: () => TransferWriter;
  compressionAdapter?: CompressionAdapter;
  timerApi?: TimerApi;
}

const defaultTransportConfig: TransportConfig = {
  chunkSize: DEFAULT_CHUNK_SIZE,
  peerConnectionCount: DEFAULT_PEER_CONNECTION_COUNT,
  dataChannelsPerConnection: DEFAULT_DATA_CHANNELS_PER_CONNECTION,
  dataChannelHighWaterMark: DATA_CHANNEL_HIGH_WATER_MARK,
  dataChannelLowWaterMark: DATA_CHANNEL_LOW_WATER_MARK,
  totalBufferedHighWaterMark: TOTAL_BUFFERED_HIGH_WATER_MARK,
  totalBufferedLowWaterMark: TOTAL_BUFFERED_LOW_WATER_MARK,
  receiverReadyTimeoutMs: DEFAULT_RECEIVER_READY_TIMEOUT_MS,
};

function createTransferSession(
  metadata: TransferMetadata | null = null
): ReceiverTransferSession {
  return {
    metadata,
    writer: null,
    resolvedFileName: metadata?.name ?? null,
    nextChunkToWrite: 0,
    pendingChunksByIndex: new Map(),
    receivedChunkCount: 0,
    receivedBytes: 0,
    receivedWireBytes: 0,
    bytesWritten: 0,
    expectedTotalChunks: metadata?.totalChunks ?? null,
    completionReceived: false,
    finalized: false,
    transferStatus: metadata ? "awaiting-save" : "idle",
    writeMode: null,
    flushPromise: Promise.resolve(),
  };
}

export class ReceiverSession {
  private readonly store: TransferStoreAdapter;

  private readonly config: TransportConfig;

  private readonly createSignalingClient: () => SignalingClientLike;

  private readonly createPeerMesh: (
    config: TransportConfig,
    roomId: string,
    rtcConfiguration: RuntimeRtcConfiguration
  ) => PeerMeshLike;

  private readonly createStreamWriter: () => TransferWriter;

  private readonly createFallbackWriter: () => TransferWriter;

  private readonly compressionAdapter: CompressionAdapter;

  private readonly timerApi: TimerApi;

  private roomId: string | null = null;

  private signalingClient: SignalingClientLike | null = null;

  private peerMesh: PeerMeshLike | null = null;

  private transferSession = createTransferSession();

  private localPeerStatus: PeerStatus = "waiting";

  private remotePeerStatus: PeerStatus = "waiting";

  private hasStartedIceChecks = false;

  private peerRecoveryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    store: TransferStoreAdapter,
    config: Partial<TransportConfig> = {},
    dependencies: ReceiverSessionDependencies = {}
  ) {
    this.store = store;
    this.config = { ...defaultTransportConfig, ...config };
    this.compressionAdapter =
      dependencies.compressionAdapter ?? new FflateCompressionAdapter();
    this.timerApi = dependencies.timerApi ?? { setTimeout, clearTimeout };
    this.createSignalingClient =
      dependencies.createSignalingClient ?? (() => new SignalingClient());
    this.createPeerMesh =
      dependencies.createPeerMesh ??
      ((meshConfig, roomId, rtcConfiguration) =>
        new PeerMesh(
          {
            role: "receiver",
            peerConnectionCount: meshConfig.peerConnectionCount,
            dataChannelsPerConnection: meshConfig.dataChannelsPerConnection,
            dataChannelHighWaterMark: meshConfig.dataChannelHighWaterMark,
            dataChannelLowWaterMark: meshConfig.dataChannelLowWaterMark,
            totalBufferedHighWaterMark: meshConfig.totalBufferedHighWaterMark,
            totalBufferedLowWaterMark: meshConfig.totalBufferedLowWaterMark,
          },
          {
            onIceCandidate: (candidate, connectionId, sender) => {
              this.handleLocalIceCandidate(candidate, connectionId, sender);
            },
            onAllConnected: () => {
              this.syncPeerStatus();
            },
            onTransportStateChange: (state) => {
              this.handleLocalPeerTransportState(state);
            },
            onDataChannelMessage: (data) => {
              void this.handleChannelMessage(data);
            },
          },
          rtcConfiguration
        ));
    this.createStreamWriter =
      dependencies.createStreamWriter ?? (() => new StreamFileWriter());
    this.createFallbackWriter =
      dependencies.createFallbackWriter ?? (() => new BlobFallbackWriter());
  }

  async connect(roomId: string): Promise<void> {
    this.roomId = roomId;
    this.localPeerStatus = "waiting";
    this.remotePeerStatus = "waiting";
    this.hasStartedIceChecks = false;
    this.clearPeerRecoveryTimeout();
    this.store.setPeerStatus("waiting");
    this.store.setConnectionStage("waiting-for-peer");
    this.store.setConnected(false);
    this.signalingClient = this.createSignalingClient();
    this.observeSignalingClient(this.signalingClient);

    try {
      const iceServers = await this.signalingClient.fetchIceServers();
      this.peerMesh = this.createPeerMesh(this.config, roomId, {
        iceServers,
        sdpSemantics: "unified-plan",
      });
      this.bindSignalingEvents();
      this.signalingClient.joinRoom({ room: roomId, role: "receiver" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown receiver initialization error.";
      this.handleConnectionSetupFailure(message);
    }
  }

  supportsDirectFileWrite(): boolean {
    return supportsDirectFileWrite();
  }

  async prepareDownload(): Promise<void> {
    const metadata = this.transferSession.metadata;
    if (!metadata || !this.signalingClient || !this.roomId) {
      return;
    }

    await this.abortWriter();
    this.transferSession = createTransferSession(metadata);

    const writer = this.supportsDirectFileWrite()
      ? this.createStreamWriter()
      : this.createFallbackWriter();

    try {
      const resolvedFileName = await writer.prepare(metadata);
      this.transferSession.writer = writer;
      this.transferSession.writeMode = writer.writeMode;
      this.transferSession.resolvedFileName = resolvedFileName;
      this.transferSession.transferStatus =
        writer.writeMode === "blob-fallback"
          ? "fallback-buffering"
          : "streaming-direct-write";

      this.syncTransferState();
      this.store.setWriteMode(writer.writeMode);
      this.store.setTransferStatus(this.transferSession.transferStatus);
      this.store.setTransferError(null);

      this.signalingClient.emit("receiver-ready", {
        room: this.roomId,
        writeMode: writer.writeMode,
        compressionMode: resolveCompressionMode(
          metadata.compressionMode,
          this.getAcceptedCompressionMode(metadata.compressionMode)
        ),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.name === "AbortError"
            ? "Save selection was cancelled."
            : error.message
          : "Unable to open the destination file.";
      await this.handleTransferFailure(errorMessage, true, true);
    }
  }

  dispose(): void {
    void this.abortWriter();
    this.clearPeerRecoveryTimeout();
    this.transferSession = createTransferSession();
    this.localPeerStatus = "waiting";
    this.remotePeerStatus = "waiting";
    this.hasStartedIceChecks = false;
    this.peerMesh?.dispose();
    this.peerMesh = null;
    this.signalingClient?.dispose();
    this.signalingClient = null;
    this.store.setConnected(false);
    this.store.setPeerStatus("waiting");
    this.store.setConnectionStage("idle");
    this.store.resetTransfer();
  }

  private observeSignalingClient(signalingClient: SignalingClientLike): void {
    signalingClient.onSignalingStatusChange((status) => {
      this.store.setSignalingStatus(status);
    });
    signalingClient.onLatencyChange((latencyMs) => {
      this.store.setSignalingLatency(latencyMs);
    });
  }

  private bindSignalingEvents(): void {
    if (!this.signalingClient) {
      return;
    }

    this.signalingClient.on("offer", (payload) => {
      void this.handleOffer(payload.connectionId, payload.offer);
    });
    this.signalingClient.on("ice-candidate", (payload) => {
      void this.peerMesh?.addIceCandidate(payload.connectionId, payload.candidate);
    });
    this.signalingClient.on("metadata", (metadata) => {
      void this.handleMetadata(metadata);
    });
    this.signalingClient.on("join-rejected", (payload) => {
      void this.handleJoinRejected(payload.reason);
    });
    this.signalingClient.on("peer-left", (payload) => {
      void this.handlePeerLeft(payload.role);
    });
    this.signalingClient.on("peer-transport-state", (payload) => {
      this.handleRemotePeerTransportState(payload.state);
    });
    this.signalingClient.on("disconnect", () => {
      this.markPeerDisconnected();
      void this.handleTransferFailure(
        "Connection to the signaling server was lost.",
        false,
        true
      );
    });
  }

  private async handleOffer(
    connectionId: number,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peerMesh || !this.signalingClient || !this.roomId) {
      return;
    }

    this.store.setConnectionStage("starting-webrtc");
    const answer = await this.peerMesh.acceptOffer(connectionId, offer);
    this.signalingClient.emit("answer", {
      room: this.roomId,
      answer,
      connectionId,
    });
  }

  private async handleMetadata(metadata: TransferMetadata): Promise<void> {
    await this.abortWriter();
    this.transferSession = createTransferSession(metadata);
    this.store.resetTransfer();
    this.store.setMetadata(metadata);
    this.store.setTransferStatus("awaiting-save");
    this.store.setTransferError(null);
    this.store.setResolvedFileName(metadata.name);
  }

  private async handleJoinRejected(reason: JoinRejectedReason): Promise<void> {
    this.store.setConnectionStage("waiting-for-peer");
    this.markPeerDisconnected();
    await this.handleTransferFailure(this.getJoinRejectedMessage(reason), false, false);
    this.cleanupFailedConnection();
  }

  private async handlePeerLeft(role: "sender" | "receiver"): Promise<void> {
    const message =
      role === "sender" ? "Sender left the room." : "Receiver left the room.";
    this.store.setConnectionStage("waiting-for-peer");
    this.markPeerDisconnected();
    await this.handleTransferFailure(message, false, true);
  }

  private handleLocalIceCandidate(
    candidate: RTCIceCandidateInit,
    connectionId: number,
    sender: "sender" | "receiver"
  ): void {
    if (!this.hasStartedIceChecks) {
      this.hasStartedIceChecks = true;
      this.store.setConnectionStage("checking-ice");
    }

    this.signalingClient?.emit("ice-candidate", {
      room: this.roomId!,
      candidate,
      sender,
      connectionId,
    });
  }

  private handleLocalPeerTransportState(state: PeerStatus): void {
    this.localPeerStatus = state;
    if (state !== "waiting" && this.signalingClient && this.roomId) {
      this.signalingClient.emit("peer-transport-state", {
        room: this.roomId,
        role: "receiver",
        state: state as PeerTransportState,
      });
    }
    this.syncPeerStatus();
  }

  private handleRemotePeerTransportState(state: PeerTransportState): void {
    this.remotePeerStatus = state;
    this.syncPeerStatus();
  }

  private syncPeerStatus(): void {
    const nextStatus = this.combinePeerStatus();
    this.store.setPeerStatus(nextStatus);
    this.store.setConnected(nextStatus === "connected" || nextStatus === "degraded");

    if (nextStatus === "disconnected") {
      this.schedulePeerRecoveryTimeout();
      return;
    }

    this.clearPeerRecoveryTimeout();
  }

  private combinePeerStatus(): PeerStatus {
    if (
      this.localPeerStatus === "disconnected" ||
      this.remotePeerStatus === "disconnected"
    ) {
      return "disconnected";
    }

    if (
      this.localPeerStatus === "degraded" ||
      this.remotePeerStatus === "degraded"
    ) {
      return "degraded";
    }

    if (
      this.localPeerStatus === "connected" ||
      this.remotePeerStatus === "connected"
    ) {
      return "connected";
    }

    return "waiting";
  }

  private schedulePeerRecoveryTimeout(): void {
    if (this.peerRecoveryTimeout != null) {
      return;
    }

    this.peerRecoveryTimeout = this.timerApi.setTimeout(() => {
      this.peerRecoveryTimeout = null;
      void this.handleTransferFailure(
        "Peer-to-peer connection was lost and could not be recovered.",
        false,
        true
      );
    }, PEER_RECOVERY_GRACE_PERIOD_MS);
  }

  private async handleChannelMessage(
    data: Blob | string | ArrayBuffer | ArrayBufferView
  ): Promise<void> {
    if (typeof data === "string") {
      return;
    }

    try {
      const message = await parseFrame(data);
      if (message.type === "data" && message.encoding === "deflate") {
        const inflatedChunk = await this.compressionAdapter.inflate(
          message.data,
          message.originalByteLength
        );
        await this.handleDataMessage({
          ...message,
          data: inflatedChunk,
          encoding: "raw",
        });
        return;
      }

      await this.handleDataMessage(message);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to decode transfer frame.";
      await this.handleTransferFailure(errorMessage, true, true);
    }
  }

  private async handleDataMessage(message: TransferFrameMessage): Promise<void> {
    if (
      this.transferSession.transferStatus !== "streaming-direct-write" &&
      this.transferSession.transferStatus !== "fallback-buffering"
    ) {
      return;
    }

    if (message.type === "complete") {
      this.transferSession.completionReceived = true;
      this.transferSession.expectedTotalChunks = message.totalChunks;
      this.queueFlush();
      return;
    }

    if (message.index < this.transferSession.nextChunkToWrite) {
      return;
    }

    if (this.transferSession.pendingChunksByIndex.has(message.index)) {
      return;
    }

    this.transferSession.pendingChunksByIndex.set(message.index, message.data);
    this.transferSession.receivedChunkCount += 1;
    this.transferSession.receivedBytes += message.originalByteLength;
    this.transferSession.receivedWireBytes += getDataFrameByteLength(
      message.wireByteLength
    );
    this.store.markReceiveStarted();
    this.store.setSizeReceived(this.transferSession.receivedBytes);
    this.syncTransferState();

    if (this.signalingClient && this.roomId) {
      this.signalingClient.emit("received", {
        room: this.roomId,
        logicalBytesReceived: this.transferSession.receivedBytes,
        wireBytesReceived: this.transferSession.receivedWireBytes,
      });
    }

    this.queueFlush();
  }

  private queueFlush(): void {
    this.transferSession.flushPromise = this.transferSession.flushPromise
      .then(async () => {
        await this.flushPendingChunks();
        await this.completeTransferIfReady();
      })
      .catch(async (error) => {
        const errorMessage =
          error instanceof Error ? error.message : "File write failed.";
        await this.handleTransferFailure(errorMessage, true, true);
      });
  }

  private async flushPendingChunks(): Promise<void> {
    const writer = this.transferSession.writer;
    if (!writer) {
      return;
    }

    while (
      this.transferSession.pendingChunksByIndex.has(
        this.transferSession.nextChunkToWrite
      )
    ) {
      const chunk = this.transferSession.pendingChunksByIndex.get(
        this.transferSession.nextChunkToWrite
      );
      if (!chunk) {
        break;
      }

      this.transferSession.pendingChunksByIndex.delete(
        this.transferSession.nextChunkToWrite
      );
      await writer.writeChunk(chunk);
      this.transferSession.bytesWritten += chunk.byteLength;
      this.transferSession.nextChunkToWrite += 1;
      this.store.setBytesWritten(this.transferSession.bytesWritten);
    }

    this.syncTransferState();
  }

  private async completeTransferIfReady(): Promise<void> {
    const metadata = this.transferSession.metadata;
    const writer = this.transferSession.writer;
    const expectedTotalChunks = this.transferSession.expectedTotalChunks;

    if (!metadata || !writer || expectedTotalChunks == null) {
      return;
    }

    const readyToFinalize =
      this.transferSession.completionReceived &&
      !this.transferSession.finalized &&
      this.transferSession.receivedChunkCount === expectedTotalChunks &&
      this.transferSession.nextChunkToWrite === expectedTotalChunks;

    if (!readyToFinalize) {
      return;
    }

    if (this.transferSession.transferStatus !== "finalizing-write") {
      this.transferSession.transferStatus = "finalizing-write";
      this.store.setTransferStatus("finalizing-write");
      if (this.signalingClient && this.roomId) {
        this.signalingClient.emit("receiver-finalizing", { room: this.roomId });
      }
    }

    const finalizedBytes = await writer.finalize(
      metadata,
      this.transferSession.resolvedFileName
    );
    if (finalizedBytes > 0) {
      this.transferSession.bytesWritten = finalizedBytes;
      this.store.setBytesWritten(finalizedBytes);
    }

    this.transferSession.finalized = true;
    this.transferSession.transferStatus = "completed";
    this.transferSession.pendingChunksByIndex.clear();
    this.syncTransferState();
    this.store.setTransferStatus("completed");
    this.store.setTransferError(null);

    posthog.capture("transfer_success", {
      room_id: this.roomId,
      role: "receiver",
      data_transferred_bytes: metadata.size,
    });

    if (this.signalingClient && this.roomId) {
      this.signalingClient.emit("transfer-complete", { room: this.roomId });
    }
  }

  private async handleTransferFailure(
    errorMessage: string,
    notifySender: boolean,
    preserveMetadata: boolean
  ): Promise<void> {
    posthog.capture("transfer_failure", {
      room_id: this.roomId,
      role: "receiver",
      error_message: errorMessage,
    });
    const metadata = preserveMetadata ? this.transferSession.metadata : null;
    const resolvedFileName = preserveMetadata
      ? this.transferSession.resolvedFileName
      : null;
    const writeMode = this.transferSession.writeMode;

    this.clearPeerRecoveryTimeout();
    await this.abortWriter();
    this.hasStartedIceChecks = false;
    this.peerMesh?.dispose(new Error(errorMessage));
    this.peerMesh = null;
    this.transferSession = createTransferSession(metadata);
    this.transferSession.resolvedFileName = resolvedFileName;
    this.transferSession.writeMode = writeMode;
    this.transferSession.transferStatus = "failed";

    this.store.resetTransfer();
    if (metadata) {
      this.store.setMetadata(metadata);
      this.store.setResolvedFileName(resolvedFileName);
    }
    this.store.setWriteMode(writeMode);
    this.store.setTransferStatus("failed");
    this.store.setTransferError(errorMessage);
    this.store.setReorderMetrics(0, -1);
    this.store.setBytesWritten(0);
    this.store.setSizeReceived(0);

    if (notifySender && this.signalingClient?.isConnected() && this.roomId) {
      this.signalingClient.emit("receiver-error", {
        room: this.roomId,
        error: errorMessage,
      });
    }
  }

  private async abortWriter(): Promise<void> {
    if (!this.transferSession.writer) {
      return;
    }

    try {
      await this.transferSession.writer.abort();
    } catch {
      // Ignore cleanup failures.
    } finally {
      this.transferSession.writer = null;
    }
  }

  private getAcceptedCompressionMode(
    requestedCompressionMode?: CompressionMode
  ): CompressionMode {
    if (
      requestedCompressionMode === DEFAULT_COMPRESSION_MODE &&
      this.compressionAdapter.isSupported()
    ) {
      return DEFAULT_COMPRESSION_MODE;
    }

    return "none";
  }

  private syncTransferState(): void {
    this.store.setResolvedFileName(this.transferSession.resolvedFileName);
    this.store.setReorderMetrics(
      this.transferSession.pendingChunksByIndex.size,
      this.transferSession.nextChunkToWrite - 1
    );
    this.store.setBytesWritten(this.transferSession.bytesWritten);
    if (this.transferSession.writeMode) {
      this.store.setWriteMode(this.transferSession.writeMode);
    }
  }

  private markPeerDisconnected(): void {
    this.localPeerStatus = "disconnected";
    this.remotePeerStatus = "disconnected";
    this.store.setPeerStatus("disconnected");
    this.store.setConnected(false);
  }

  private clearPeerRecoveryTimeout(): void {
    if (!this.peerRecoveryTimeout) {
      return;
    }

    this.timerApi.clearTimeout(this.peerRecoveryTimeout);
    this.peerRecoveryTimeout = null;
  }

  private cleanupFailedConnection(): void {
    this.peerMesh?.dispose();
    this.peerMesh = null;
    this.signalingClient?.dispose();
    this.signalingClient = null;
  }

  private handleConnectionSetupFailure(errorMessage: string): void {
    this.clearPeerRecoveryTimeout();
    this.peerMesh?.dispose(new Error(errorMessage));
    this.peerMesh = null;
    this.signalingClient?.dispose();
    this.signalingClient = null;
    this.store.setConnected(false);
    this.store.setPeerStatus("waiting");
    this.store.setConnectionStage("idle");
    this.store.setTransferStatus("failed");
    this.store.setTransferError(errorMessage);
  }

  private getJoinRejectedMessage(reason: JoinRejectedReason): string {
    switch (reason) {
      case "sender-not-found":
        return "Share code not found or already expired.";
      case "duplicate-role":
        return "A receiver is already connected to this room.";
      case "room-full":
      default:
        return "This room already has both participants.";
    }
  }
}

export default ReceiverSession;
