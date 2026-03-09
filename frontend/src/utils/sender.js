import { io } from "socket.io-client";
import { useTransferStore } from "../store.js";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";

const DATA_CHANNEL_HIGH_WATER_MARK = 512 * 1024;
const DATA_CHANNEL_LOW_WATER_MARK = 256 * 1024;
const TOTAL_BUFFERED_HIGH_WATER_MARK = 8 * 1024 * 1024;
const TOTAL_BUFFERED_LOW_WATER_MARK = 4 * 1024 * 1024;

export default class Sender extends Connection {
  peerConnection = null;
  temp = 0;
  socket = null;
  offers = [];
  uniqueId = null;
  isUniqueIDSet = false;
  dataChannel = null;
  dataChannels = [];
  peerConnections = [];
  dataChannel2 = null;
  partReceived = false;
  noOfPeerConnections = 0;
  pendingFile = null;
  currentMetadata = null;
  receiverReady = false;
  receiverReadyTimeout = null;
  receiverReadyTimeoutMs = 30000;
  nextConnectionIndex = 0;
  nextDataChannelIndex = 0;

  constructor() {
    super();
    this.noOfPeerConnections = 12;
    this.peerConnections = this.createPeerConnections(this.noOfPeerConnections);
    this.uniqueId = this.getRandomIDandJoinRoom();
    this.socket = io(serverAddress);

    for (let i = 0; i < this.noOfPeerConnections; i++) {
      this.dataChannels[i] = [];
      this.createDataChannels(10, i);
    }
    this.initiatePeerConnectionListners();
    this.initiateSocketListeners();
  }

  initiatePeerConnectionListners() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.peerConnections[i].onicecandidate = (event) => {
        this.handleIceCandidate(event, "sender", i);
      };
      this.peerConnections[i].oniceconnectionstatechange = () => {
        if (
          this.peerConnections[i].iceConnectionState === "connected" ||
          this.peerConnections[i].iceConnectionState === "completed"
        ) {
          this.temp++;
          if (this.temp == this.noOfPeerConnections) {
            useTransferStore.getState().setConnected(true);
          }
        }
      };
    }
  }

  createDataChannels(noOfDataChannels, connectionId) {
    for (let i = 0; i < noOfDataChannels; i++) {
      const dataChannel = this.peerConnections[connectionId].createDataChannel(
        "MultiDataChannel_" + connectionId + "_" + i
      );

      this.dataChannels[connectionId].push(dataChannel);
      dataChannel.binaryType = "arraybuffer";
      dataChannel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER_MARK;
      dataChannel.onopen = () => {};
      dataChannel.onclose = () => {};
    }
  }

  initiateSocketListeners() {
    this.socket.on("answer", (data) => {
      this.handleAnswer(data);
    });
    this.socket.on("receiver-ready", (data) => {
      this.handleReceiverReady(data);
    });
    this.socket.on("receiver-error", (data) => {
      this.handleReceiverError(data);
    });
    this.socket.on("receiver-finalizing", () => {
      this.handleReceiverFinalizing();
    });
    this.socket.on("transfer-complete", () => {
      this.handleTransferComplete();
    });
    this.socket.on("received", (data) => {
      useTransferStore.getState().setSizeReceived(data);
      if (this.currentMetadata && data >= this.currentMetadata.size) {
        useTransferStore.getState().updateTransfer({
          transferStatus: "finalizing-write",
          error: null,
        });
      }
    });
    this.socket.on("room-full", () => {
      this.handleRoomFull();
    });
    this.socket.on("ice-candidate", (data) => {
      const candidate = data.candidate;
      const connectionId = data.connectionId;
      this.peerConnections[connectionId].addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });
    this.socket.on("disconnect", () => {
      this.clearReceiverReadyTimeout();
      if (this.pendingFile || this.currentMetadata) {
        useTransferStore.getState().updateTransfer({
          transferStatus: "failed",
          error: "Connection to the signaling server was lost.",
        });
      }
    });
  }

  async handleRoomFull() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.offers.push(await this.createOffer(i));
    }
  }

  async handleAnswer(data) {
    const connectionId = data.connectionId;
    const answer = data.answer;
    if (
      this.peerConnections[connectionId].signalingState ===
        "have-local-offer" ||
      this.peerConnections[connectionId].signalingState === "have-remote-offer"
    ) {
      await this.peerConnections[connectionId].setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    } else {
      console.error(
        "Peer connection not in correct state to set remote description:",
        this.peerConnections[connectionId].signalingState
      );
    }
  }

  async createOffer(connectionId) {
    const offer = await this.peerConnections[connectionId].createOffer({
      offerToReceiveAudio: true,
      offerToReceiveData: true,
    });
    await this.peerConnections[connectionId].setLocalDescription(offer);
    await this.sendToSocket("offer", {
      room: this.uniqueId,
      offer: offer,
      connectionId: connectionId,
    });
    return offer;
  }

  async getRandomIDandJoinRoom() {
    try {
      const response = await fetch(serverAddress + "/random");
      this.uniqueId = await response.text();
      this.sendToSocket("join-room", this.uniqueId);
      this.isUniqueIDSet = true;
    } catch {
      console.log("Server not responding");
      setTimeout(() => {
        this.getRandomIDandJoinRoom();
      }, 1000);
    }
  }

  clearReceiverReadyTimeout() {
    if (this.receiverReadyTimeout) {
      clearTimeout(this.receiverReadyTimeout);
      this.receiverReadyTimeout = null;
    }
  }

  handleReceiverReady(data) {
    if (!this.pendingFile) {
      return;
    }

    this.receiverReady = true;
    this.clearReceiverReadyTimeout();
    useTransferStore.getState().updateTransfer({
      transferStatus:
        data?.writeMode === "blob-fallback"
          ? "fallback-buffering"
          : "streaming-direct-write",
      writeMode: data?.writeMode ?? null,
      error: null,
    });

    const fileToSend = this.pendingFile;
    this.pendingFile = null;
    void this.beginTransfer(fileToSend);
  }

  handleReceiverError(data) {
    this.clearReceiverReadyTimeout();
    this.pendingFile = null;
    this.currentMetadata = null;
    useTransferStore.getState().updateTransfer({
      transferStatus: "failed",
      error: data?.error || "Receiver failed to start the download.",
    });
  }

  handleReceiverFinalizing() {
    if (!this.currentMetadata) {
      return;
    }

    useTransferStore.getState().updateTransfer({
      transferStatus: "finalizing-write",
      error: null,
    });
  }

  handleTransferComplete() {
    if (!this.currentMetadata) {
      return;
    }

    this.currentMetadata = null;
    useTransferStore.getState().updateTransfer({
      transferStatus: "completed",
      error: null,
    });
  }

  sendFile(file) {
    if (!file) {
      return;
    }

    this.clearReceiverReadyTimeout();
    useTransferStore.getState().resetTransfer();

    const chunkSize = 1024 * 128;
    const totalChunks = Math.ceil(file.size / chunkSize);

    this.pendingFile = file;
    this.receiverReady = false;
    this.currentMetadata = {
      room: this.uniqueId,
      type: file.type,
      size: file.size,
      name: file.name,
      chunkSize,
      totalChunks,
    };

    useTransferStore.getState().updateTransfer({
      transferStatus: "awaiting-receiver",
      transferSize: file.size,
      error: null,
    });

    this.sendToSocket("metadata", this.currentMetadata);
    this.receiverReadyTimeout = setTimeout(() => {
      if (!this.receiverReady) {
        this.pendingFile = null;
        this.currentMetadata = null;
        useTransferStore.getState().updateTransfer({
          transferStatus: "failed",
          error: "Receiver did not choose a destination in time.",
        });
      }
    }, this.receiverReadyTimeoutMs);
  }

  getAllDataChannels() {
    return this.dataChannels.flat();
  }

  getTotalBufferedAmount() {
    return this.getAllDataChannels().reduce(
      (total, channel) => total + channel.bufferedAmount,
      0
    );
  }

  waitForCondition(predicate, intervalMs = 25) {
    return new Promise((resolve) => {
      if (predicate()) {
        resolve();
        return;
      }

      const interval = setInterval(() => {
        if (predicate()) {
          clearInterval(interval);
          resolve();
        }
      }, intervalMs);
    });
  }

  async waitForGlobalDrain() {
    if (this.getTotalBufferedAmount() <= TOTAL_BUFFERED_HIGH_WATER_MARK) {
      return;
    }

    await this.waitForCondition(
      () => this.getTotalBufferedAmount() <= TOTAL_BUFFERED_LOW_WATER_MARK
    );
  }

  getNextOpenChannel() {
    const connectionCount = this.dataChannels.length;

    for (let connectionOffset = 0; connectionOffset < connectionCount; connectionOffset++) {
      const connectionId =
        (this.nextConnectionIndex + connectionOffset) % connectionCount;
      const channels = this.dataChannels[connectionId];

      for (let channelOffset = 0; channelOffset < channels.length; channelOffset++) {
        const channelIndex =
          (this.nextDataChannelIndex + channelOffset) % channels.length;
        const channel = channels[channelIndex];

        if (channel.readyState === "open") {
          this.nextConnectionIndex = (connectionId + 1) % connectionCount;
          this.nextDataChannelIndex = (channelIndex + 1) % channels.length;
          return channel;
        }
      }
    }

    return null;
  }

  async sendFrame(frame) {
    const channel = this.getNextOpenChannel();
    if (!channel) {
      throw new Error("No open data channels are available for transfer.");
    }

    if (channel.bufferedAmount > DATA_CHANNEL_HIGH_WATER_MARK) {
      await this.waitForCondition(
        () =>
          channel.readyState === "open" &&
          channel.bufferedAmount <= DATA_CHANNEL_LOW_WATER_MARK
      );
    }

    channel.send(frame);
  }

  async beginTransfer(file) {
    const blob = new Blob([file]);
    const chunkSize = this.currentMetadata?.chunkSize ?? 1024 * 128;
    let offset = 0;
    let index = 0;

    try {
      while (offset < blob.size) {
        await this.waitForGlobalDrain();

        const slice = blob.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();
        const frame = this.createDataFrame(index, buffer);

        await this.sendFrame(frame);
        index++;
        offset += chunkSize;
      }

      await this.waitForGlobalDrain();
      await this.sendFrame(
        this.createCompleteFrame(this.currentMetadata?.totalChunks ?? index)
      );
    } catch (error) {
      useTransferStore.getState().updateTransfer({
        transferStatus: "failed",
        error: error?.message || "Unable to send the file.",
      });
    }
  }
}
