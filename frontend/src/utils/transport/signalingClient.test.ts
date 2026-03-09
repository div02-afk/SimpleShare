import { describe, expect, it, vi } from "vitest";
import { SignalingClient } from "./signalingClient";

describe("SignalingClient", () => {
  it("does not create a socket during room-id fetch", async () => {
    const socketFactory = vi.fn(() => {
      return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        disconnect: vi.fn(),
        connected: false,
      };
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
    const socket = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
      connected: true,
    };
    const socketFactory = vi.fn(() => socket);
    const client = new SignalingClient({
      socketFactory: socketFactory as never,
      fetchImplementation: vi.fn(),
    });

    client.on("room-full", vi.fn());
    client.joinRoom("room-123");

    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(socket.on).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith("join-room", "room-123");
  });
});
