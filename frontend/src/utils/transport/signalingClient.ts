import { io, type Socket } from "socket.io-client";
import type { SignalingStatus } from "../../types/transfer";
import serverAddress from "../serverLink";
import type {
  ClientToServerEvents,
  JoinRoomPayload,
  ServerToClientEvents,
  SignalingClientLike,
} from "./types";

type SocketFactory = () => Socket<ServerToClientEvents, ClientToServerEvents>;
type FetchImplementation = typeof fetch;

interface TimerApi {
  clearInterval: typeof clearInterval;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  setTimeout: typeof setTimeout;
}

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;

export interface SignalingClientOptions {
  socketFactory?: SocketFactory;
  fetchImplementation?: FetchImplementation;
  timerApi?: TimerApi;
  now?: () => number;
}

export class SignalingClient implements SignalingClientLike {
  private readonly socketFactory: SocketFactory;

  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  private readonly fetchImplementation: FetchImplementation;

  private readonly unsubscribers: Array<() => void> = [];

  private readonly timerApi: TimerApi;

  private readonly now: () => number;

  private readonly signalingStatusListeners = new Set<
    (status: SignalingStatus) => void
  >();

  private readonly latencyListeners = new Set<(latencyMs: number | null) => void>();

  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

  private signalingStatus: SignalingStatus = "connecting";

  private latencyMs: number | null = null;

  constructor(options: SignalingClientOptions = {}) {
    this.socketFactory = options.socketFactory ?? (() => io(serverAddress));
    this.fetchImplementation =
      options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.timerApi = options.timerApi ?? {
      clearInterval,
      clearTimeout,
      setInterval,
      setTimeout,
    };
    this.now = options.now ?? (() => Date.now());
  }

  async fetchRoomId(): Promise<string> {
    const roomIdUrl = `${serverAddress}/random`;

    if (import.meta.env.DEV) {
      console.debug("[sender:init] requesting room id", roomIdUrl);
    }

    let response: Response;

    try {
      response = await this.fetchImplementation(roomIdUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      if (import.meta.env.DEV) {
        console.error("[sender:init] room id request failed", {
          roomIdUrl,
          error,
        });
      }
      throw new Error(
        `Unable to reach the signaling server at ${roomIdUrl}: ${message}`
      );
    }

    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.error("[sender:init] room id request returned non-ok response", {
          roomIdUrl,
          status: response.status,
          statusText: response.statusText,
        });
      }
      throw new Error(
        `Unable to request a room id from the signaling server at ${roomIdUrl}.`
      );
    }

    if (import.meta.env.DEV) {
      console.debug("[sender:init] room id request succeeded", roomIdUrl);
    }

    return response.text();
  }

  joinRoom(payload: JoinRoomPayload): void {
    this.emit("join-room", payload);
  }

  emit<K extends keyof ClientToServerEvents>(
    event: K,
    ...args: Parameters<ClientToServerEvents[K]>
  ): void {
    this.requireSocket().emit(event, ...args);
  }

  on<K extends keyof ServerToClientEvents>(
    event: K,
    handler: ServerToClientEvents[K]
  ): () => void {
    const socket = this.requireSocket();
    socket.on(event, handler as never);

    const unsubscribe = () => {
      this.socket?.off(event, handler as never);
    };

    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  onSignalingStatusChange(handler: (status: SignalingStatus) => void): () => void {
    this.signalingStatusListeners.add(handler);
    handler(this.signalingStatus);
    return () => {
      this.signalingStatusListeners.delete(handler);
    };
  }

  onLatencyChange(handler: (latencyMs: number | null) => void): () => void {
    this.latencyListeners.add(handler);
    handler(this.latencyMs);
    return () => {
      this.latencyListeners.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  dispose(): void {
    while (this.unsubscribers.length > 0) {
      const unsubscribe = this.unsubscribers.pop();
      unsubscribe?.();
    }

    this.stopHeartbeat();
    this.socket?.disconnect();
    this.socket = null;
    this.setLatency(null);
    this.setSignalingStatus("disconnected");
  }

  private requireSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
    if (!this.socket) {
      this.socket = this.socketFactory();
      this.bindSocketEvents(this.socket);
      this.setSignalingStatus("connecting");
    }

    return this.socket;
  }

  private bindSocketEvents(
    socket: Socket<ServerToClientEvents, ClientToServerEvents>
  ): void {
    socket.on("connect", () => {
      this.setSignalingStatus("connected");
      this.startHeartbeat();
    });

    socket.on("disconnect", () => {
      this.stopHeartbeat();
      this.setLatency(null);
      this.setSignalingStatus("disconnected");
    });

    socket.on("ws-pong", (payload) => {
      this.setLatency(Math.max(0, this.now() - payload.sentAt));
      this.setSignalingStatus("connected");
      this.scheduleHeartbeatTimeout();
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeat();
    this.heartbeatInterval = this.timerApi.setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    this.scheduleHeartbeatTimeout();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval != null) {
      this.timerApi.clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout != null) {
      this.timerApi.clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.socket?.connected) {
      return;
    }

    const sentAt = this.now();
    this.socket.emit("ws-ping", { sentAt });
  }

  private scheduleHeartbeatTimeout(): void {
    if (this.heartbeatTimeout != null) {
      this.timerApi.clearTimeout(this.heartbeatTimeout);
    }

    this.heartbeatTimeout = this.timerApi.setTimeout(() => {
      if (this.socket?.connected) {
        this.setSignalingStatus("degraded");
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private setSignalingStatus(status: SignalingStatus): void {
    if (this.signalingStatus === status) {
      return;
    }

    this.signalingStatus = status;
    this.signalingStatusListeners.forEach((listener) => {
      listener(status);
    });
  }

  private setLatency(latencyMs: number | null): void {
    if (this.latencyMs === latencyMs) {
      return;
    }

    this.latencyMs = latencyMs;
    this.latencyListeners.forEach((listener) => {
      listener(latencyMs);
    });
  }
}

export default SignalingClient;
