import { describe, expect, it, vi } from "vitest";
import type { TransferMetadata } from "../../types/transfer";
import type { TransferStoreAdapter } from "./types";
import ReceiverSession from "./receiverSession";

class MockSignalingClient {
  handlers = new Map<string, (...args: unknown[]) => unknown>();

  emitted: Array<{ event: string; payload: unknown }> = [];

  fetchRoomId = vi.fn();

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

  createOffer = vi.fn();

  acceptOffer = vi.fn(async () => ({ type: "answer", sdp: "answer" }));

  applyAnswer = vi.fn();

  addIceCandidate = vi.fn(async () => {});

  sendFrame = vi.fn();

  waitForGlobalDrain = vi.fn();

  noteBytesAcknowledged = vi.fn();

  dispose = vi.fn();
}

class MockWriter {
  constructor(public readonly writeMode: "stream" | "blob-fallback") {}

  prepare = vi.fn(async (metadata: TransferMetadata) => metadata.name);

  writeChunk = vi.fn(async () => {});

  finalize = vi.fn(async () => 5);

  abort = vi.fn(async () => {});
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

const metadata: TransferMetadata = {
  room: "room-123",
  type: "text/plain",
  size: 5,
  name: "hello.txt",
  chunkSize: 5,
  totalChunks: 2,
};

describe("ReceiverSession", () => {
  it("stores metadata and moves into awaiting-save state", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);

    expect(store.resetTransfer).toHaveBeenCalled();
    expect(store.setMetadata).toHaveBeenCalledWith(metadata);
    expect(store.setTransferStatus).toHaveBeenCalledWith("awaiting-save");
  });

  it("starts fallback downloads and notifies the sender", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const fallbackWriter = new MockWriter("blob-fallback");
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      createFallbackWriter: () => fallbackWriter as never,
    });

    vi.spyOn(session, "supportsDirectFileWrite").mockReturnValue(false);

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);
    await session.prepareDownload();

    expect(fallbackWriter.prepare).toHaveBeenCalledWith(metadata);
    expect(signaling.emitted).toContainEqual({
      event: "receiver-ready",
      payload: { room: "room-123", writeMode: "blob-fallback" },
    });
  });

  it("flushes ordered chunks and completes the transfer", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const fallbackWriter = new MockWriter("blob-fallback");
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      createFallbackWriter: () => fallbackWriter as never,
    });

    vi.spyOn(session, "supportsDirectFileWrite").mockReturnValue(false);

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);
    await session.prepareDownload();

    const internal = session as unknown as {
      handleDataMessage: (message: unknown) => Promise<void>;
    };

    await internal.handleDataMessage({
      type: "data",
      index: 1,
      byteLength: 2,
      data: new Uint8Array([4, 5]),
    });
    await internal.handleDataMessage({
      type: "data",
      index: 0,
      byteLength: 3,
      data: new Uint8Array([1, 2, 3]),
    });
    await internal.handleDataMessage({
      type: "complete",
      totalChunks: 2,
    });
    await (session as unknown as {
      transferSession: { flushPromise: Promise<void> };
    }).transferSession.flushPromise;

    expect(fallbackWriter.writeChunk).toHaveBeenCalledTimes(2);
    expect(fallbackWriter.finalize).toHaveBeenCalled();
    expect(signaling.emitted).toContainEqual({
      event: "transfer-complete",
      payload: { room: "room-123" },
    });
  });
});
