import type { TransferMetadata } from "../../types/transfer";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_DATA_CHANNELS_PER_CONNECTION,
  DEFAULT_PEER_CONNECTION_COUNT,
  DEFAULT_RECEIVER_READY_TIMEOUT_MS,
  DATA_CHANNEL_HIGH_WATER_MARK,
  DATA_CHANNEL_LOW_WATER_MARK,
  TOTAL_BUFFERED_HIGH_WATER_MARK,
  TOTAL_BUFFERED_LOW_WATER_MARK,
} from "./config";
import { createCompleteFrame, createDataFrame } from "./frameProtocol";
import PeerMesh from "./peerMesh";
import SignalingClient from "./signalingClient";
import type {
  PeerMeshLike,
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

  private signalingClient: SignalingClientLike | null = null;

  private peerMesh: PeerMeshLike | null = null;

  private pendingFile: File | null = null;

  private currentMetadata: TransferMetadata | null = null;

  private receiverReady = false;

  private receiverReadyTimeout: ReturnType<typeof setTimeout> | null = null;

  private roomId: string | null = null;

  private initPromise: Promise<{ roomId: string }> | null = null;

  private disposed = false;

  constructor(
    store: TransferStoreAdapter,
    config: Partial<TransportConfig> = {},
    dependencies: SenderSessionDependencies = {}
  ) {
    this.store = store;
    this.config = { ...defaultTransportConfig, ...config };
    this.timerApi = dependencies.timerApi ?? { setTimeout, clearTimeout };
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
              this.store.setConnected(true);
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
        signalingClient.joinRoom(roomId);
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
    this.currentMetadata = {
      room: this.roomId,
      type: file.type,
      size: file.size,
      name: file.name,
      chunkSize: this.config.chunkSize,
      totalChunks: Math.ceil(file.size / this.config.chunkSize),
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
      this.store.setTransferStatus("failed");
      this.store.setTransferError("Receiver did not choose a destination in time.");
    }, this.config.receiverReadyTimeoutMs);
  }

  dispose(): void {
    this.disposed = true;
    this.clearReceiverReadyTimeout();
    this.pendingFile = null;
    this.currentMetadata = null;
    this.receiverReady = false;
    this.peerMesh?.dispose();
    this.peerMesh = null;
    this.signalingClient?.dispose();
    this.signalingClient = null;
    this.store.setConnected(false);
    this.store.resetTransfer();
  }

  private bindSignalingEvents(): void {
    if (!this.signalingClient) {
      return;
    }

    this.signalingClient.on("answer", (payload) => {
      void this.peerMesh?.applyAnswer(payload.connectionId, payload.answer);
    });
    this.signalingClient.on("receiver-ready", (payload) => {
      this.handleReceiverReady(payload.writeMode);
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
      this.store.setTransferStatus("completed");
      this.store.setTransferError(null);
    });
    this.signalingClient.on("received", (bytesReceived) => {
      this.peerMesh?.noteBytesAcknowledged(bytesReceived);
      this.store.setSizeReceived(bytesReceived);
      if (this.currentMetadata && bytesReceived >= this.currentMetadata.size) {
        this.store.setTransferStatus("finalizing-write");
        this.store.setTransferError(null);
      }
    });
    this.signalingClient.on("room-full", () => {
      void this.handleRoomFull();
    });
    this.signalingClient.on("ice-candidate", (payload) => {
      void this.peerMesh?.addIceCandidate(payload.connectionId, payload.candidate);
    });
    this.signalingClient.on("disconnect", () => {
      this.handleTransferFailure("Connection to the signaling server was lost.");
    });
  }

  private async handleRoomFull(): Promise<void> {
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

  private handleReceiverReady(writeMode: "stream" | "blob-fallback"): void {
    if (!this.pendingFile) {
      return;
    }

    this.receiverReady = true;
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
        const frame = createDataFrame(index, buffer);
        await this.peerMesh.sendFrame(frame, buffer.byteLength);

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

  private handleTransferFailure(errorMessage: string): void {
    this.clearReceiverReadyTimeout();
    this.pendingFile = null;
    this.currentMetadata = null;
    this.receiverReady = false;
    this.peerMesh?.dispose(new Error(errorMessage));
    this.store.setTransferStatus("failed");
    this.store.setTransferError(errorMessage);
  }

  private clearReceiverReadyTimeout(): void {
    if (!this.receiverReadyTimeout) {
      return;
    }

    this.timerApi.clearTimeout(this.receiverReadyTimeout);
    this.receiverReadyTimeout = null;
  }
}

export default SenderSession;
