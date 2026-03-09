import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferStoreAdapter } from "./types";
import SenderSession from "./senderSession";

class MockSignalingClient {
  handlers = new Map<string, (...args: unknown[]) => unknown>();

  emitted: Array<{ event: string; payload: unknown }> = [];

  fetchRoomId = vi.fn(async () => "room-123");

  joinRoom = vi.fn();

  emit(event: string, payload: unknown) {
    this.emitted.push({ event, payload });
  }

  on(event: string, handler: (...args: unknown[]) => unknown) {
    this.handlers.set(event, handler);
    return () => {
      this.handlers.delete(event);
    };
  }

  isConnected() {
    return true;
  }

  dispose = vi.fn();

  async trigger(event: string, payload?: unknown) {
    const handler = this.handlers.get(event);
    await handler?.(payload);
  }
}

class MockPeerMesh {
  connectionCount = 2;

  createOffer = vi.fn(async (connectionId: number) => ({ type: "offer", sdp: `${connectionId}` }));

  acceptOffer = vi.fn();

  applyAnswer = vi.fn(async () => {});

  addIceCandidate = vi.fn(async () => {});

  sendFrame = vi.fn(async () => {});

  waitForGlobalDrain = vi.fn(async () => {});

  noteBytesAcknowledged = vi.fn();

  dispose = vi.fn();
}

function createStoreAdapter(): TransferStoreAdapter {
  return {
    setConnected: vi.fn(),
    setMetadata: vi.fn(),
    setSizeReceived: vi.fn(),
    setBytesWritten: vi.fn(),
    setTransferStatus: vi.fn(),
    setWriteMode: vi.fn(),
    setTransferError: vi.fn(),
    setResolvedFileName: vi.fn(),
    setTransferSize: vi.fn(),
    setReorderMetrics: vi.fn(),
    markReceiveStarted: vi.fn(),
    updateTransfer: vi.fn(),
    resetTransfer: vi.fn(),
  };
}

describe("SenderSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("initializes the room and joins signaling", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    const result = await session.init();

    expect(result.roomId).toBe("room-123");
    expect(signaling.joinRoom).toHaveBeenCalledWith("room-123");
  });

  it("fails if the receiver never becomes ready", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.init();
    await session.sendFile(new File(["hello"], "hello.txt", { type: "text/plain" }));

    vi.advanceTimersByTime(30000);

    expect(store.setTransferStatus).toHaveBeenCalledWith("failed");
    expect(store.setTransferError).toHaveBeenCalledWith(
      "Receiver did not choose a destination in time."
    );
  });

  it("starts sending frames once the receiver is ready", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.init();
    await session.sendFile(new File(["hello"], "hello.txt", { type: "text/plain" }));
    await signaling.trigger("receiver-ready", {
      room: "room-123",
      writeMode: "stream",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(peerMesh.sendFrame).toHaveBeenCalled();
    expect(store.setTransferStatus).toHaveBeenCalledWith("streaming-direct-write");
  });
});
