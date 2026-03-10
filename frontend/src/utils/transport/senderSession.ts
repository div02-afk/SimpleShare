import type {
  CompressionMode,
  PeerStatus,
  TransferMetadata,
} from "../../types/transfer";
import {
  createCompressionProbeState,
  DEFAULT_COMPRESSION_MODE,
  FflateCompressionAdapter,
  isCompressionEligibleFile,
  type CompressionAdapter,
  type CompressionProbeState,
  resolveCompressionMode,
  shouldUseCompressedChunk,
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
import {
  createCompleteFrame,
  createDataFrame,
  getDataFrameByteLength,
} from "./frameProtocol";
import PeerMesh from "./peerMesh";
import SignalingClient from "./signalingClient";
import type {
  JoinRejectedReason,
  PeerMeshLike,
  PeerTransportState,
  SignalingClientLike,
  TransferStoreAdapter,
  TransportConfig,
} from "./types";

interface TimerApi {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

interface SenderSessionDependencies {
  createSignalingClient?: () => SignalingClientLike;
  createPeerMesh?: (config: TransportConfig, roomId: string) => PeerMeshLike;
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

export class SenderSession {
  private readonly store: TransferStoreAdapter;

  private readonly config: TransportConfig;

  private readonly timerApi: TimerApi;

  private readonly createSignalingClient: () => SignalingClientLike;

  private readonly createPeerMesh: (
    config: TransportConfig,
    roomId: string
  ) => PeerMeshLike;

  private readonly compressionAdapter: CompressionAdapter;

  private signalingClient: SignalingClientLike | null = null;

  private peerMesh: PeerMeshLike | null = null;

  private pendingFile: File | null = null;

  private currentMetadata: TransferMetadata | null = null;

  private receiverReady = false;

  private receiverReadyTimeout: ReturnType<typeof setTimeout> | null = null;

  private peerRecoveryTimeout: ReturnType<typeof setTimeout> | null = null;

  private roomId: string | null = null;

  private initPromise: Promise<{ roomId: string }> | null = null;

  private activeCompressionMode: CompressionMode = "none";

  private compressionProbeState: CompressionProbeState =
    createCompressionProbeState();

  private localPeerStatus: PeerStatus = "waiting";

  private remotePeerStatus: PeerStatus = "waiting";

  private disposed = false;

  constructor(
    store: TransferStoreAdapter,
    config: Partial<TransportConfig> = {},
    dependencies: SenderSessionDependencies = {}
  ) {
    this.store = store;
    this.config = { ...defaultTransportConfig, ...config };
    this.timerApi = dependencies.timerApi ?? { setTimeout, clearTimeout };
    this.compressionAdapter =
      dependencies.compressionAdapter ?? new FflateCompressionAdapter();
    this.createSignalingClient =
      dependencies.createSignalingClient ?? (() => new SignalingClient());
    this.createPeerMesh =
      dependencies.createPeerMesh ??
      ((meshConfig, roomId) =>
        new PeerMesh(
          {
            role: "sender",
            peerConnectionCount: meshConfig.peerConnectionCount,
            dataChannelsPerConnection: meshConfig.dataChannelsPerConnection,
            dataChannelHighWaterMark: meshConfig.dataChannelHighWaterMark,
            dataChannelLowWaterMark: meshConfig.dataChannelLowWaterMark,
            totalBufferedHighWaterMark: meshConfig.totalBufferedHighWaterMark,
            totalBufferedLowWaterMark: meshConfig.totalBufferedLowWaterMark,
          },
          {
            onIceCandidate: (candidate, connectionId, sender) => {
              this.signalingClient?.emit("ice-candidate", {
                room: roomId,
                candidate,
                sender,
                connectionId,
              });
            },
            onAllConnected: () => {
              this.syncPeerStatus();
            },
            onTransportStateChange: (state) => {
              this.handleLocalPeerTransportState(state);
            },
          }
        ));
  }

  async init(): Promise<{ roomId: string }> {
    if (this.disposed) {
      throw new Error("Sender session has been disposed.");
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.signalingClient && this.roomId) {
      return { roomId: this.roomId };
    }

    this.initPromise = (async () => {
      const signalingClient = this.createSignalingClient();
      this.signalingClient = signalingClient;
      this.localPeerStatus = "waiting";
      this.remotePeerStatus = "waiting";
      this.store.setPeerStatus("waiting");
      this.store.setConnected(false);
      this.observeSignalingClient(signalingClient);

      try {
        const roomId = await signalingClient.fetchRoomId();
        if (this.disposed) {
          signalingClient.dispose();
          throw new Error("Sender session was disposed during initialization.");
        }

        this.roomId = roomId;
        try {
          this.peerMesh = this.createPeerMesh(this.config, roomId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown WebRTC error.";
          throw new Error(
            `Unable to initialize the sender WebRTC transport: ${message}`
          );
        }
        this.bindSignalingEvents();
        signalingClient.joinRoom({ room: roomId, role: "sender" });
        return { roomId };
      } catch (error) {
        if (this.signalingClient === signalingClient) {
          signalingClient.dispose();
          this.signalingClient = null;
        }
        this.roomId = null;
        this.peerMesh = null;
        throw error;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async sendFile(file: File): Promise<void> {
    if (!this.signalingClient || !this.peerMesh || !this.roomId) {
      throw new Error("Sender session has not been initialized.");
    }

    if (this.pendingFile || this.currentMetadata) {
      throw new Error("A transfer is already in progress.");
    }

    this.clearReceiverReadyTimeout();
    this.store.resetTransfer();
    this.pendingFile = file;
    this.receiverReady = false;
    this.activeCompressionMode = "none";
    this.compressionProbeState = createCompressionProbeState();
    this.currentMetadata = {
      room: this.roomId,
      type: file.type,
      size: file.size,
      name: file.name,
      chunkSize: this.config.chunkSize,
      totalChunks: Math.ceil(file.size / this.config.chunkSize),
      compressionMode:
        this.compressionAdapter.isSupported() &&
        isCompressionEligibleFile(file.name, file.type)
          ? DEFAULT_COMPRESSION_MODE
          : "none",
    };

    this.store.setTransferSize(file.size);
    this.store.setTransferStatus("awaiting-receiver");
    this.store.setTransferError(null);
    this.store.setSizeReceived(0);
    this.store.setBytesWritten(0);
    this.store.setWriteMode(null);
    this.signalingClient.emit("metadata", this.currentMetadata);

    this.receiverReadyTimeout = this.timerApi.setTimeout(() => {
      if (this.receiverReady) {
        return;
      }

      this.pendingFile = null;
      this.currentMetadata = null;
      this.activeCompressionMode = "none";
      this.compressionProbeState = createCompressionProbeState();
      this.store.setTransferStatus("failed");
      this.store.setTransferError("Receiver did not choose a destination in time.");
    }, this.config.receiverReadyTimeoutMs);
  }

  dispose(): void {
    this.disposed = true;
    this.clearReceiverReadyTimeout();
    this.clearPeerRecoveryTimeout();
    this.pendingFile = null;
    this.currentMetadata = null;
    this.receiverReady = false;
    this.activeCompressionMode = "none";
    this.compressionProbeState = createCompressionProbeState();
    this.localPeerStatus = "waiting";
    this.remotePeerStatus = "waiting";
    this.peerMesh?.dispose();
    this.peerMesh = null;
    this.signalingClient?.dispose();
    this.signalingClient = null;
    this.store.setConnected(false);
    this.store.setPeerStatus("waiting");
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

    this.signalingClient.on("answer", (payload) => {
      void this.peerMesh?.applyAnswer(payload.connectionId, payload.answer);
    });
    this.signalingClient.on("receiver-ready", (payload) => {
      this.handleReceiverReady(payload.writeMode, payload.compressionMode);
    });
    this.signalingClient.on("receiver-error", (payload) => {
      this.handleTransferFailure(payload.error);
    });
    this.signalingClient.on("receiver-finalizing", () => {
      if (!this.currentMetadata) {
        return;
      }

      this.store.setTransferStatus("finalizing-write");
      this.store.setTransferError(null);
    });
    this.signalingClient.on("transfer-complete", () => {
      if (!this.currentMetadata) {
        return;
      }

      this.currentMetadata = null;
      this.pendingFile = null;
      this.activeCompressionMode = "none";
      this.compressionProbeState = createCompressionProbeState();
      this.store.setTransferStatus("completed");
      this.store.setTransferError(null);
    });
    this.signalingClient.on("received", (payload) => {
      this.peerMesh?.noteBytesAcknowledged(payload.wireBytesReceived);
      this.store.setSizeReceived(payload.logicalBytesReceived);
      if (
        this.currentMetadata &&
        payload.logicalBytesReceived >= this.currentMetadata.size
      ) {
        this.store.setTransferStatus("finalizing-write");
        this.store.setTransferError(null);
      }
    });
    this.signalingClient.on("room-ready", () => {
      void this.handleRoomReady();
    });
    this.signalingClient.on("join-rejected", (payload) => {
      this.handleJoinRejected(payload.reason);
    });
    this.signalingClient.on("peer-left", (payload) => {
      this.handlePeerLeft(payload.role);
    });
    this.signalingClient.on("peer-transport-state", (payload) => {
      this.handleRemotePeerTransportState(payload.state);
    });
    this.signalingClient.on("ice-candidate", (payload) => {
      void this.peerMesh?.addIceCandidate(payload.connectionId, payload.candidate);
    });
    this.signalingClient.on("disconnect", () => {
      this.markPeerDisconnected();
      this.handleTransferFailure("Connection to the signaling server was lost.");
    });
  }

  private async handleRoomReady(): Promise<void> {
    if (!this.peerMesh || !this.signalingClient || !this.roomId) {
      return;
    }

    for (
      let connectionId = 0;
      connectionId < this.peerMesh.connectionCount;
      connectionId += 1
    ) {
      const offer = await this.peerMesh.createOffer(connectionId);
      this.signalingClient.emit("offer", {
        room: this.roomId,
        offer,
        connectionId,
      });
    }
  }

  private handleJoinRejected(reason: JoinRejectedReason): void {
    this.markPeerDisconnected();
    this.handleTransferFailure(this.getJoinRejectedMessage(reason));
  }

  private handlePeerLeft(role: "sender" | "receiver"): void {
    const message =
      role === "receiver" ? "Receiver left the room." : "Sender left the room.";
    this.markPeerDisconnected();
    this.handleTransferFailure(message);
  }

  private handleLocalPeerTransportState(state: PeerStatus): void {
    this.localPeerStatus = state;
    if (state !== "waiting" && this.signalingClient && this.roomId) {
      this.signalingClient.emit("peer-transport-state", {
        room: this.roomId,
        role: "sender",
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
      this.handleTransferFailure(
        "Peer-to-peer connection was lost and could not be recovered."
      );
    }, PEER_RECOVERY_GRACE_PERIOD_MS);
  }

  private handleReceiverReady(
    writeMode: "stream" | "blob-fallback",
    acceptedCompressionMode?: CompressionMode
  ): void {
    if (!this.pendingFile || !this.currentMetadata) {
      return;
    }

    this.receiverReady = true;
    this.activeCompressionMode = resolveCompressionMode(
      this.currentMetadata.compressionMode,
      acceptedCompressionMode
    );
    this.clearReceiverReadyTimeout();
    this.store.setWriteMode(writeMode);
    this.store.setTransferStatus(
      writeMode === "blob-fallback"
        ? "fallback-buffering"
        : "streaming-direct-write"
    );
    this.store.setTransferError(null);

    const file = this.pendingFile;
    this.pendingFile = null;
    void this.beginTransfer(file);
  }

  private async beginTransfer(file: File): Promise<void> {
    if (!this.peerMesh || !this.currentMetadata) {
      return;
    }

    let offset = 0;
    let index = 0;

    try {
      while (offset < file.size) {
        await this.peerMesh.waitForGlobalDrain();

        const slice = file.slice(offset, offset + this.currentMetadata.chunkSize);
        const buffer = await slice.arrayBuffer();
        const chunk = new Uint8Array(buffer);
        const { encoding, payload } = await this.prepareChunkForTransfer(chunk);
        const frame = createDataFrame(
          index,
          payload,
          encoding,
          chunk.byteLength
        );
        await this.peerMesh.sendFrame(frame, getDataFrameByteLength(payload.byteLength));

        index += 1;
        offset += this.currentMetadata.chunkSize;
      }

      await this.peerMesh.waitForGlobalDrain();
      await this.peerMesh.sendFrame(
        createCompleteFrame(this.currentMetadata.totalChunks),
        0
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to send the file.";
      this.handleTransferFailure(errorMessage);
    }
  }

  private async prepareChunkForTransfer(
    chunk: Uint8Array
  ): Promise<{ encoding: "raw" | "deflate"; payload: Uint8Array }> {
    if (
      this.activeCompressionMode !== DEFAULT_COMPRESSION_MODE ||
      this.compressionProbeState.disabledForRemainder
    ) {
      return {
        encoding: "raw",
        payload: chunk,
      };
    }

    const compressedChunk = await this.compressionAdapter.deflate(chunk);
    const decision = shouldUseCompressedChunk(
      this.compressionProbeState,
      chunk.byteLength,
      compressedChunk.byteLength
    );

    if (decision.shouldDisableFutureCompression) {
      this.activeCompressionMode = "none";
    }

    if (!decision.useCompressed) {
      return {
        encoding: "raw",
        payload: chunk,
      };
    }

    return {
      encoding: "deflate",
      payload: compressedChunk,
    };
  }

  private handleTransferFailure(errorMessage: string): void {
    this.clearReceiverReadyTimeout();
    this.clearPeerRecoveryTimeout();
    this.pendingFile = null;
    this.currentMetadata = null;
    this.receiverReady = false;
    this.activeCompressionMode = "none";
    this.compressionProbeState = createCompressionProbeState();
    this.peerMesh?.dispose(new Error(errorMessage));
    this.peerMesh = null;
    this.store.setTransferStatus("failed");
    this.store.setTransferError(errorMessage);
  }

  private markPeerDisconnected(): void {
    this.localPeerStatus = "disconnected";
    this.remotePeerStatus = "disconnected";
    this.store.setPeerStatus("disconnected");
    this.store.setConnected(false);
  }

  private clearReceiverReadyTimeout(): void {
    if (!this.receiverReadyTimeout) {
      return;
    }

    this.timerApi.clearTimeout(this.receiverReadyTimeout);
    this.receiverReadyTimeout = null;
  }

  private clearPeerRecoveryTimeout(): void {
    if (!this.peerRecoveryTimeout) {
      return;
    }

    this.timerApi.clearTimeout(this.peerRecoveryTimeout);
    this.peerRecoveryTimeout = null;
  }

  private getJoinRejectedMessage(reason: JoinRejectedReason): string {
    switch (reason) {
      case "sender-not-found":
        return "The sender room does not exist.";
      case "duplicate-role":
        return "A sender is already using this room.";
      case "room-full":
      default:
        return "This room already has both participants.";
    }
  }
}

export default SenderSession;
