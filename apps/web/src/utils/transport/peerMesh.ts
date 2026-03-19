import type { PeerStatus } from "../../types/transfer";
import type {
  PeerMeshConfig,
  PeerMeshDependencies,
  PeerMeshLike,
  RuntimeRtcConfiguration,
} from "./types";

interface InFlightWaiter {
  maxBytes: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class PeerMesh implements PeerMeshLike {
  readonly connectionCount: number;

  private readonly config: PeerMeshConfig;

  private readonly dependencies: PeerMeshDependencies;

  private readonly rtcConfiguration: RuntimeRtcConfiguration;

  private readonly peerConnections: RTCPeerConnection[];

  private readonly dataChannels: RTCDataChannel[][];

  private readonly connectedConnectionIds = new Set<number>();

  private readonly connectionIceStates: RTCIceConnectionState[];

  private readonly openChannelCounts: number[];

  private readonly hadOpenChannels: boolean[];

  private bytesSent = 0;

  private bytesAcknowledged = 0;

  private inFlightWaiters: InFlightWaiter[] = [];

  private nextConnectionIndex = 0;

  private nextDataChannelIndex = 0;

  private lastTransportState: PeerStatus = "waiting";

  private hasEverConnected = false;

  private disposed = false;

  constructor(
    config: PeerMeshConfig,
    dependencies: PeerMeshDependencies,
    rtcConfiguration: RuntimeRtcConfiguration
  ) {
    this.config = config;
    this.dependencies = dependencies;
    this.rtcConfiguration = rtcConfiguration;
    this.connectionCount = config.peerConnectionCount;
    const peerConnectionFactory =
      dependencies.peerConnectionFactory ??
      ((rtcConfig: RTCConfiguration) => new RTCPeerConnection(rtcConfig));

    this.peerConnections = Array.from({ length: config.peerConnectionCount }, () =>
      peerConnectionFactory(this.rtcConfiguration)
    );
    this.dataChannels = Array.from({ length: config.peerConnectionCount }, () => []);
    this.connectionIceStates = Array.from(
      { length: config.peerConnectionCount },
      () => "new" as RTCIceConnectionState
    );
    this.openChannelCounts = Array.from(
      { length: config.peerConnectionCount },
      () => 0
    );
    this.hadOpenChannels = Array.from(
      { length: config.peerConnectionCount },
      () => false
    );

    this.peerConnections.forEach((peerConnection, connectionId) => {
      this.attachPeerConnectionListeners(peerConnection, connectionId);
      if (config.role === "sender") {
        this.createDataChannels(connectionId);
      }
    });

    this.emitTransportStateIfChanged();
  }

  async createOffer(connectionId: number): Promise<RTCSessionDescriptionInit> {
    const peerConnection = this.requirePeerConnection(connectionId);
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
    });
    await peerConnection.setLocalDescription(offer);
    return offer;
  }

  async acceptOffer(
    connectionId: number,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const peerConnection = this.requirePeerConnection(connectionId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    return answer;
  }

  async applyAnswer(
    connectionId: number,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    const peerConnection = this.requirePeerConnection(connectionId);
    if (peerConnection.signalingState !== "have-local-offer") {
      throw new Error(
        `Peer connection ${connectionId} is not ready for an answer.`
      );
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addIceCandidate(
    connectionId: number,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const peerConnection = this.requirePeerConnection(connectionId);
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  noteBytesAcknowledged(bytesAcknowledged: number): void {
    this.bytesAcknowledged = bytesAcknowledged;
    this.flushInFlightWaiters();
  }

  async waitForGlobalDrain(): Promise<void> {
    if (this.getInFlightBytes() <= this.config.totalBufferedHighWaterMark) {
      return;
    }

    await this.waitForInFlightBytes(this.config.totalBufferedLowWaterMark);
  }

  async sendFrame(frame: ArrayBuffer, accountedWireBytes = frame.byteLength): Promise<void> {
    const channel = this.getNextOpenChannel();
    if (!channel) {
      throw new Error("No open data channels are available for transfer.");
    }

    if (channel.bufferedAmount > this.config.dataChannelHighWaterMark) {
      await this.waitForChannelDrain(channel);
    }

    channel.send(frame);
    this.bytesSent += accountedWireBytes;
  }

  dispose(error = new Error("Transport mesh disposed.")): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.rejectInFlightWaiters(error);

    this.dataChannels.flat().forEach((channel) => {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // Ignore close errors during cleanup.
      }
    });

    this.peerConnections.forEach((peerConnection) => {
      peerConnection.onicecandidate = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.ondatachannel = null;
      try {
        peerConnection.close();
      } catch {
        // Ignore close errors during cleanup.
      }
    });
  }

  private attachPeerConnectionListeners(
    peerConnection: RTCPeerConnection,
    connectionId: number
  ): void {
    peerConnection.onicecandidate = (event) => {
      const candidate = event.candidate?.toJSON();
      if (!candidate) {
        return;
      }

      this.dependencies.onIceCandidate(candidate, connectionId, this.config.role);
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      this.connectionIceStates[connectionId] = state;

      if (state === "connected" || state === "completed") {
        this.connectedConnectionIds.add(connectionId);
        if (this.connectedConnectionIds.size === this.connectionCount) {
          this.dependencies.onAllConnected();
        }
      } else {
        this.connectedConnectionIds.delete(connectionId);
      }

      this.emitTransportStateIfChanged();
    };

    if (this.config.role === "receiver") {
      peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        this.dataChannels[connectionId]!.push(channel);
        this.attachDataChannelListeners(channel, connectionId, true);
      };
    }
  }

  private attachDataChannelListeners(
    channel: RTCDataChannel,
    connectionId: number,
    attachMessageHandler: boolean
  ): void {
    if (attachMessageHandler) {
      channel.onmessage = ({ data }) => {
        this.dependencies.onDataChannelMessage?.(data, connectionId);
      };
    }

    channel.onopen = () => {
      this.openChannelCounts[connectionId] =
        (this.openChannelCounts[connectionId] ?? 0) + 1;
      this.hadOpenChannels[connectionId] = true;
      this.emitTransportStateIfChanged();
    };

    channel.onclose = () => {
      this.openChannelCounts[connectionId] = Math.max(
        0,
        (this.openChannelCounts[connectionId] ?? 0) - 1
      );
      if (attachMessageHandler) {
        channel.onmessage = null;
      }
      this.emitTransportStateIfChanged();
    };

    if (channel.readyState === "open") {
      this.openChannelCounts[connectionId] =
        (this.openChannelCounts[connectionId] ?? 0) + 1;
      this.hadOpenChannels[connectionId] = true;
      this.emitTransportStateIfChanged();
    }
  }

  private createDataChannels(connectionId: number): void {
    const peerConnection = this.peerConnections[connectionId];
    if (!peerConnection) {
      return;
    }

    for (let index = 0; index < this.config.dataChannelsPerConnection; index += 1) {
      const channel = peerConnection.createDataChannel(
        `MultiDataChannel_${connectionId}_${index}`
      );
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = this.config.dataChannelLowWaterMark;
      this.dataChannels[connectionId]!.push(channel);
      this.attachDataChannelListeners(channel, connectionId, false);
    }
  }

  private getNextOpenChannel(): RTCDataChannel | null {
    for (
      let connectionOffset = 0;
      connectionOffset < this.dataChannels.length;
      connectionOffset += 1
    ) {
      const connectionId =
        (this.nextConnectionIndex + connectionOffset) % this.dataChannels.length;
      const channels = this.dataChannels[connectionId];
      if (!channels || channels.length === 0) {
        continue;
      }

      for (let channelOffset = 0; channelOffset < channels.length; channelOffset += 1) {
        const channelIndex =
          (this.nextDataChannelIndex + channelOffset) % channels.length;
        const channel = channels[channelIndex];
        if (!channel || channel.readyState !== "open") {
          continue;
        }

        this.nextConnectionIndex = (connectionId + 1) % this.dataChannels.length;
        this.nextDataChannelIndex = (channelIndex + 1) % channels.length;
        return channel;
      }
    }

    return null;
  }

  private getInFlightBytes(): number {
    return Math.max(0, this.bytesSent - this.bytesAcknowledged);
  }

  private waitForInFlightBytes(maxBytes: number): Promise<void> {
    if (this.getInFlightBytes() <= maxBytes) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.inFlightWaiters.push({ maxBytes, resolve, reject });
    });
  }

  private flushInFlightWaiters(): void {
    const remainingWaiters: InFlightWaiter[] = [];

    this.inFlightWaiters.forEach((waiter) => {
      if (this.getInFlightBytes() <= waiter.maxBytes) {
        waiter.resolve();
      } else {
        remainingWaiters.push(waiter);
      }
    });

    this.inFlightWaiters = remainingWaiters;
  }

  private rejectInFlightWaiters(error: Error): void {
    this.inFlightWaiters.forEach((waiter) => {
      waiter.reject(error);
    });
    this.inFlightWaiters = [];
  }

  private waitForChannelDrain(channel: RTCDataChannel): Promise<void> {
    if (
      channel.readyState !== "open" ||
      channel.bufferedAmount <= this.config.dataChannelLowWaterMark
    ) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const handleLow = () => {
        cleanup();
        resolve();
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("Data channel closed during transfer."));
      };
      const cleanup = () => {
        channel.removeEventListener("bufferedamountlow", handleLow);
        channel.removeEventListener("close", handleClose);
      };

      channel.addEventListener("bufferedamountlow", handleLow);
      channel.addEventListener("close", handleClose);

      if (
        channel.readyState !== "open" ||
        channel.bufferedAmount <= this.config.dataChannelLowWaterMark
      ) {
        cleanup();
        resolve();
      }
    });
  }

  private emitTransportStateIfChanged(): void {
    const nextState = this.getTransportState();
    if (nextState === "connected" || nextState === "degraded") {
      this.hasEverConnected = true;
    }

    if (this.lastTransportState === nextState) {
      return;
    }

    this.lastTransportState = nextState;
    this.dependencies.onTransportStateChange?.(nextState);
  }

  private getTransportState(): PeerStatus {
    const usableConnectionCount = this.connectionIceStates.reduce(
      (count, _state, connectionId) =>
        count + (this.isConnectionUsable(connectionId) ? 1 : 0),
      0
    );

    if (usableConnectionCount === 0) {
      return this.hasEverConnected ? "disconnected" : "waiting";
    }

    const brokenConnectionCount = this.connectionIceStates.reduce(
      (count, _state, connectionId) =>
        count + (this.isConnectionBroken(connectionId) ? 1 : 0),
      0
    );

    return brokenConnectionCount > 0 ? "degraded" : "connected";
  }

  private isConnectionUsable(connectionId: number): boolean {
    const iceState = this.connectionIceStates[connectionId];
    return (
      (this.openChannelCounts[connectionId] ?? 0) > 0 &&
      (iceState === "connected" || iceState === "completed")
    );
  }

  private isConnectionBroken(connectionId: number): boolean {
    const iceState = this.connectionIceStates[connectionId];

    if (
      iceState === "failed" ||
      iceState === "disconnected" ||
      iceState === "closed"
    ) {
      return true;
    }

    return (
      Boolean(this.hadOpenChannels[connectionId]) &&
      (this.openChannelCounts[connectionId] ?? 0) === 0
    );
  }

  private requirePeerConnection(connectionId: number): RTCPeerConnection {
    const peerConnection = this.peerConnections[connectionId];
    if (!peerConnection) {
      throw new Error(`Unknown peer connection ${connectionId}.`);
    }

    return peerConnection;
  }
}

export default PeerMesh;
