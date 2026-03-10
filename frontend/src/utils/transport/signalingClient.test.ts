import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignalingClient } from "./signalingClient";

function createMockSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>();

  return {
    connected: false,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
    }),
    disconnect: vi.fn(),
    trigger(event: string, payload?: unknown) {
      handlers.get(event)?.(payload);
    },
  };
}

describe("SignalingClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not create a socket during room-id fetch", async () => {
    const socketFactory = vi.fn(() => {
      return createMockSocket();
    });
    const fetchImplementation = vi.fn(async () => {
      return {
        ok: true,
        text: async () => "room-123",
      } as Response;
    });

    const client = new SignalingClient({
      socketFactory: socketFactory as never,
      fetchImplementation,
    });

    await expect(client.fetchRoomId()).resolves.toBe("room-123");
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("uses a bound global fetch by default", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => {
      return {
        ok: true,
        text: async () => "room-456",
      } as Response;
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const client = new SignalingClient();
      await expect(client.fetchRoomId()).resolves.toBe("room-456");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates the socket lazily when subscribing or emitting", () => {
    const socket = createMockSocket();
    const socketFactory = vi.fn(() => socket as never);
    const client = new SignalingClient({
      socketFactory: socketFactory as never,
      fetchImplementation: vi.fn(),
    });

    client.on("room-ready", vi.fn());
    client.joinRoom({ room: "room-123", role: "sender" });

    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(socket.on).toHaveBeenCalledWith("room-ready", expect.any(Function));
    expect(socket.emit).toHaveBeenCalledWith("join-room", {
      room: "room-123",
      role: "sender",
    });
  });

  it("tracks websocket latency and degraded status through heartbeats", () => {
    let now = 1000;
    const socket = createMockSocket();
    const client = new SignalingClient({
      socketFactory: () => socket as never,
      fetchImplementation: vi.fn(),
      now: () => now,
      timerApi: {
        setInterval,
        clearInterval,
        setTimeout,
        clearTimeout,
      },
    });
    const statuses: string[] = [];
    const latencies: Array<number | null> = [];

    client.onSignalingStatusChange((status) => {
      statuses.push(status);
    });
    client.onLatencyChange((latency) => {
      latencies.push(latency);
    });

    client.joinRoom({ room: "room-123", role: "sender" });
    socket.connected = true;
    socket.trigger("connect");

    expect(socket.emit).toHaveBeenLastCalledWith("ws-ping", { sentAt: 1000 });

    now = 1120;
    socket.trigger("ws-pong", {
      sentAt: 1000,
      serverTime: 1110,
    });

    expect(latencies[latencies.length - 1]).toBe(120);

    vi.advanceTimersByTime(15000);
    expect(statuses).toContain("degraded");

    socket.connected = false;
    socket.trigger("disconnect");
    expect(statuses[statuses.length - 1]).toBe("disconnected");
  });
});
