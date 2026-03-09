import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";
import store from "../store.js";

const DIRECT_WRITE_STATUS = "streaming-direct-write";
const FALLBACK_STATUS = "fallback-buffering";

export default class Receiver extends Connection {
  peerConnection = null;
  socket = null;
  uniqueId = null;
  dataChannel = null;
  dataChannel2 = null;
  metadata = null;
  peerConnections = [];
  temp = 0;
  noOfPeerConnections = 0;
  transferSession = null;

  constructor(uniqueId) {
    super();
    this.noOfPeerConnections = 12;
    this.peerConnections = this.createPeerConnections(this.noOfPeerConnections);
    this.uniqueId = uniqueId;
    this.socket = io(serverAddress);
    this.transferSession = this.createTransferSession();
    this.initiateSocketListeners();
    this.initiatePeerConnectionListners();
  }

  createTransferSession(metadata = null) {
    const originalExtension = this.getOriginalExtension(metadata?.name);
    const resolvedFileName = metadata?.name
      ? this.ensureExtension(metadata.name, originalExtension)
      : null;

    return {
      metadata,
      originalExtension,
      resolvedFileName,
      writableStream: null,
      nextChunkToWrite: 0,
      pendingChunksByIndex: new Map(),
      fallbackChunks: [],
      receivedChunkCount: 0,
      receivedBytes: 0,
      bytesWritten: 0,
      expectedTotalChunks: metadata?.totalChunks ?? null,
      completionReceived: false,
      status: "idle",
      writeMode: null,
      flushPromise: Promise.resolve(),
      finalized: false,
    };
  }

  supportsDirectFileWrite() {
    return (
      typeof window !== "undefined" &&
      typeof window.showSaveFilePicker === "function"
    );
  }

  getOriginalExtension(fileName = "") {
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
      return "";
    }

    return fileName.slice(lastDotIndex).toLowerCase();
  }

  ensureExtension(fileName, originalExtension) {
    if (!fileName || !originalExtension) {
      return fileName;
    }

    if (fileName.toLowerCase().endsWith(originalExtension)) {
      return fileName;
    }

    return `${fileName}${originalExtension}`;
  }

  createSavePickerOptions() {
    const suggestedName = this.transferSession.resolvedFileName || this.metadata.name;
    const { originalExtension } = this.transferSession;

    if (!originalExtension) {
      return {
        suggestedName,
      };
    }

    return {
      suggestedName,
      types: [
        {
          description: this.metadata.type || "Transferred file",
          accept: {
            [this.metadata.type || "application/octet-stream"]: [
              originalExtension,
            ],
          },
        },
      ],
    };
  }

  syncTransferState(overrides = {}) {
    store.dispatch({
      type: "TRANSFER_UPDATE",
      payload: {
        resolvedFileName: this.transferSession.resolvedFileName,
        reorderBufferSize: this.transferSession.pendingChunksByIndex.size,
        highestContiguousWrittenIndex: this.transferSession.nextChunkToWrite - 1,
        bytesWritten: this.transferSession.bytesWritten,
        ...overrides,
      },
    });
  }

  logDirectWriteState(reason) {
    if (this.transferSession.writeMode !== "stream") {
      return;
    }

    console.debug("[receiver]", reason, {
      pendingChunks: this.transferSession.pendingChunksByIndex.size,
      highestContiguousWrittenIndex: this.transferSession.nextChunkToWrite - 1,
      receivedChunkCount: this.transferSession.receivedChunkCount,
    });
  }

  async prepareDownload() {
    if (!this.metadata) {
      return;
    }

    await this.resetTransferSession(false);
    this.transferSession = this.createTransferSession(this.metadata);

    if (!this.supportsDirectFileWrite()) {
      this.transferSession.writeMode = "blob-fallback";
      this.transferSession.status = FALLBACK_STATUS;
      this.syncTransferState({
        transferStatus: FALLBACK_STATUS,
        writeMode: "blob-fallback",
        error: null,
      });
      this.sendToSocket("receiver-ready", {
        room: this.uniqueId,
        writeMode: this.transferSession.writeMode,
      });
      return;
    }

    try {
      const handle = await window.showSaveFilePicker(this.createSavePickerOptions());
      const resolvedFileName = this.ensureExtension(
        handle.name,
        this.transferSession.originalExtension
      );

      if (resolvedFileName !== handle.name) {
        throw new Error(
          `Please keep the original ${this.transferSession.originalExtension} extension when choosing the file name.`
        );
      }

      const writableStream = await handle.createWritable();
      this.transferSession.writableStream = writableStream;
      this.transferSession.writeMode = "stream";
      this.transferSession.status = DIRECT_WRITE_STATUS;
      this.transferSession.resolvedFileName = resolvedFileName;
      this.syncTransferState({
        transferStatus: DIRECT_WRITE_STATUS,
        writeMode: "stream",
        error: null,
      });
      this.sendToSocket("receiver-ready", {
        room: this.uniqueId,
        writeMode: this.transferSession.writeMode,
      });
    } catch (error) {
      const errorMessage =
        error?.name === "AbortError"
          ? "Save selection was cancelled."
          : error?.message || "Unable to open the destination file.";
      await this.handleTransferFailure(errorMessage, {
        notifySender: true,
        preserveMetadata: true,
      });
    }
  }

  initiatePeerConnectionListners() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.dataChannelHandler(i);
      this.peerConnections[i].onicecandidate = (event) => {
        this.handleIceCandidate(event, "receiver", i);
      };
      this.peerConnections[i].oniceconnectionstatechange = () => {
        if (
          this.peerConnections[i].iceConnectionState === "connected" ||
          this.peerConnections[i].iceConnectionState === "completed"
        ) {
          this.temp++;
          if (this.temp == this.noOfPeerConnections) {
            store.dispatch({ type: "ALL_CONNECTED" });
          }
        }
      };
    }
  }

  initiateSocketListeners() {
    this.socket.emit("join-room", this.uniqueId);
    this.socket.on("offer", (data) => {
      this.handleOffer(data);
    });
    this.socket.on("ice-candidate", (data) => {
      const candidate = data.candidate;
      const connectionId = data.connectionId;
      this.peerConnections[connectionId].addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });
    this.socket.on("metadata", (metadata) => {
      void this.handleMetadata(metadata);
    });
    this.socket.on("disconnect", () => {
      void this.handleTransferFailure(
        "Connection to the signaling server was lost.",
        { notifySender: false, preserveMetadata: true }
      );
    });
  }

  async handleMetadata(metadata) {
    await this.resetTransferSession(false);
    this.metadata = metadata;
    this.transferSession = this.createTransferSession(metadata);
    store.dispatch({ type: "RESET_TRANSFER" });
    store.dispatch({ type: "METADATA", payload: metadata });
    this.syncTransferState({
      transferStatus: "awaiting-save",
      writeMode: null,
      error: null,
    });
  }

  async handleOffer(data) {
    const connectionId = data.connectionId;
    const offer = data.offer;
    await this.peerConnections[connectionId].setRemoteDescription(
      new RTCSessionDescription(offer)
    );
    const answer = await this.peerConnections[connectionId].createAnswer();
    await this.peerConnections[connectionId].setLocalDescription(answer);
    this.sendToSocket("answer", {
      room: this.uniqueId,
      answer: answer,
      connectionId: connectionId,
    });
  }

  async sendToSocket(type, msg) {
    this.socket.emit(type, msg);
  }

  queueFlush() {
    this.transferSession.flushPromise = this.transferSession.flushPromise
      .then(async () => {
        await this.flushPendingChunks();
        await this.completeTransferIfReady();
      })
      .catch(async (error) => {
        await this.handleTransferFailure(error?.message || "File write failed.", {
          notifySender: true,
          preserveMetadata: true,
        });
      });
  }

  async flushPendingChunks() {
    if (this.transferSession.writeMode !== "stream") {
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
      this.transferSession.pendingChunksByIndex.delete(
        this.transferSession.nextChunkToWrite
      );
      await this.transferSession.writableStream.write(chunk);
      this.transferSession.bytesWritten += chunk.byteLength;
      store.dispatch({
        type: "BYTES_WRITTEN",
        payload: this.transferSession.bytesWritten,
      });
      this.transferSession.nextChunkToWrite++;
    }

    this.syncTransferState();
    this.logDirectWriteState("flushed contiguous chunks");
  }

  async completeTransferIfReady() {
    const shouldFinalize =
      this.transferSession.completionReceived &&
      !this.transferSession.finalized &&
      this.transferSession.expectedTotalChunks != null &&
      this.transferSession.receivedChunkCount ===
        this.transferSession.expectedTotalChunks;

    if (shouldFinalize && this.transferSession.status !== "finalizing-write") {
      this.transferSession.status = "finalizing-write";
      this.syncTransferState({
        transferStatus: "finalizing-write",
      });
      this.sendToSocket("receiver-finalizing", {
        room: this.uniqueId,
      });
    }

    if (
      !this.transferSession.completionReceived ||
      this.transferSession.finalized ||
      this.transferSession.expectedTotalChunks == null ||
      this.transferSession.receivedChunkCount !==
        this.transferSession.expectedTotalChunks
    ) {
      return;
    }

    if (
      this.transferSession.writeMode === "stream" &&
      this.transferSession.nextChunkToWrite !==
        this.transferSession.expectedTotalChunks
    ) {
      return;
    }

    if (this.transferSession.writeMode === "stream") {
      await this.transferSession.writableStream.close();
      this.transferSession.writableStream = null;
    } else {
      const blob = new Blob(this.transferSession.fallbackChunks, {
        type: this.metadata?.type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        this.transferSession.resolvedFileName ||
        this.metadata?.name ||
        "download.bin";
      link.click();
      URL.revokeObjectURL(url);
      this.transferSession.bytesWritten = this.transferSession.receivedBytes;
      store.dispatch({
        type: "BYTES_WRITTEN",
        payload: this.transferSession.bytesWritten,
      });
    }

    this.transferSession.pendingChunksByIndex.clear();
    this.transferSession.fallbackChunks = [];
    this.transferSession.finalized = true;
    this.transferSession.status = "completed";
    this.sendToSocket("transfer-complete", {
      room: this.uniqueId,
    });
    this.syncTransferState({
      transferStatus: "completed",
      error: null,
      reorderBufferSize: 0,
      highestContiguousWrittenIndex: this.transferSession.nextChunkToWrite - 1,
    });
  }

  async handleTransferFailure(
    errorMessage,
    { notifySender = false, preserveMetadata = true } = {}
  ) {
    const metadataToPreserve = preserveMetadata ? this.metadata : null;
    const resolvedFileName = preserveMetadata
      ? this.transferSession.resolvedFileName
      : null;
    const writeMode = this.transferSession.writeMode;

    if (this.transferSession?.writableStream) {
      try {
        await this.transferSession.writableStream.abort();
      } catch {
        // Ignore abort failures during cleanup.
      }
    }

    if (notifySender && this.socket?.connected) {
      this.sendToSocket("receiver-error", {
        room: this.uniqueId,
        error: errorMessage,
      });
    }

    this.transferSession.pendingChunksByIndex.clear();
    this.transferSession.fallbackChunks = [];
    this.transferSession.completionReceived = false;
    this.transferSession.receivedBytes = 0;
    this.transferSession.bytesWritten = 0;
    this.transferSession.receivedChunkCount = 0;
    this.transferSession.nextChunkToWrite = 0;

    this.transferSession = this.createTransferSession(metadataToPreserve);
    this.transferSession.resolvedFileName = resolvedFileName;
    this.transferSession.writeMode = writeMode;
    this.transferSession.status = "failed";

    store.dispatch({ type: "RESET_TRANSFER" });
    if (metadataToPreserve) {
      store.dispatch({ type: "METADATA", payload: metadataToPreserve });
    }
    this.syncTransferState({
      transferStatus: "failed",
      writeMode,
      error: errorMessage,
      reorderBufferSize: 0,
      highestContiguousWrittenIndex: -1,
    });
  }

  async resetTransferSession(resetStore = true) {
    if (this.transferSession?.writableStream) {
      try {
        await this.transferSession.writableStream.abort();
      } catch {
        // Ignore abort failures when starting a new transfer.
      }
    }

    this.transferSession = this.createTransferSession();
    if (resetStore) {
      store.dispatch({ type: "RESET_TRANSFER" });
    }
  }

  async handleDataMessage(message) {
    if (
      this.transferSession.status !== DIRECT_WRITE_STATUS &&
      this.transferSession.status !== FALLBACK_STATUS
    ) {
      return;
    }

    if (message.type === "the file sharing is completed") {
      this.transferSession.completionReceived = true;
      this.transferSession.expectedTotalChunks =
        message.totalChunks ?? this.transferSession.expectedTotalChunks;
      this.queueFlush();
      return;
    }

    if (message.type !== "data") {
      return;
    }

    const arrayBuffer = message.data;
    const index = message.index;
    const byteLength = message.byteLength ?? arrayBuffer.byteLength;

    if (this.transferSession.writeMode === "stream") {
      if (
        index < this.transferSession.nextChunkToWrite ||
        this.transferSession.pendingChunksByIndex.has(index)
      ) {
        return;
      }

      this.transferSession.pendingChunksByIndex.set(index, arrayBuffer);
      this.syncTransferState();
      this.logDirectWriteState("queued chunk");
      this.queueFlush();
    } else {
      if (this.transferSession.fallbackChunks[index]) {
        return;
      }

      this.transferSession.fallbackChunks[index] = arrayBuffer;
    }

    this.transferSession.receivedChunkCount++;
    this.transferSession.receivedBytes += byteLength;

    store.dispatch({ type: "RECEIVE" });
    store.dispatch({
      type: "SIZE_RECEIVED",
      payload: this.transferSession.receivedBytes,
    });
    this.sendToSocket("received", {
      data: this.transferSession.receivedBytes,
      room: this.uniqueId,
    });

    if (this.transferSession.writeMode === "blob-fallback") {
      this.queueFlush();
    }
  }

  dataChannelHandler(connectionId) {
    this.peerConnections[connectionId].ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.dataChannel.binaryType = "arraybuffer";
      this.dataChannel.onopen = () =>
        console.log("Data channel is open for", connectionId);
      this.dataChannel.onclose = () => console.log("Data channel is closed");
      this.dataChannel.onmessage = (event) => {
        if (event.data instanceof Blob) {
          event.data
            .arrayBuffer()
            .then((buffer) => {
              const message = this.parseFrame(buffer);
              void this.handleDataMessage(message);
            })
            .catch((error) => {
              void this.handleTransferFailure(
                error?.message || "Unable to decode transfer frame.",
                { notifySender: true, preserveMetadata: true }
              );
            });
          return;
        }

        try {
          if (
            event.data instanceof ArrayBuffer ||
            ArrayBuffer.isView(event.data)
          ) {
            const message = this.parseFrame(event.data);
            void this.handleDataMessage(message);
          } else {
            console.log("Data channel received message", event.data);
          }
        } catch (error) {
          void this.handleTransferFailure(
            error?.message || "Unable to decode transfer frame.",
            { notifySender: true, preserveMetadata: true }
          );
        }
      };
    };
  }
}
