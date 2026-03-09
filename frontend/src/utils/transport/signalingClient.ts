import { io, type Socket } from "socket.io-client";
import serverAddress from "../serverLink";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SignalingClientLike,
} from "./types";

type SocketFactory = () => Socket<ServerToClientEvents, ClientToServerEvents>;
type FetchImplementation = typeof fetch;

export interface SignalingClientOptions {
  socketFactory?: SocketFactory;
  fetchImplementation?: FetchImplementation;
}

export class SignalingClient implements SignalingClientLike {
  private readonly socketFactory: SocketFactory;

  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  private readonly fetchImplementation: FetchImplementation;

  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: SignalingClientOptions = {}) {
    this.socketFactory = options.socketFactory ?? (() => io(serverAddress));
    this.fetchImplementation =
      options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
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

  joinRoom(roomId: string): void {
    this.emit("join-room", roomId);
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

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  dispose(): void {
    while (this.unsubscribers.length > 0) {
      const unsubscribe = this.unsubscribers.pop();
      unsubscribe?.();
    }

    this.socket?.disconnect();
    this.socket = null;
  }

  private requireSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
    if (!this.socket) {
      this.socket = this.socketFactory();
    }

    return this.socket;
  }
}

export default SignalingClient;
