import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferMetadata } from "../../types/transfer";
import { createDataFrame } from "./frameProtocol";
import type { TransferStoreAdapter } from "./types";
import ReceiverSession from "./receiverSession";

const mockIceServers: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
    username: "user",
    credential: "credential",
  },
];

class MockSignalingClient {
  handlers = new Map<string, (...args: unknown[]) => unknown>();

  emitted: Array<{ event: string; payload: unknown }> = [];

  fetchRoomId = vi.fn();

  fetchIceServers = vi.fn(async () => mockIceServers);

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

  onSignalingStatusChange(handler: (status: "connecting" | "connected") => void) {
    handler("connected");
    return () => {};
  }

  onLatencyChange(handler: (latencyMs: number | null) => void) {
    handler(null);
    return () => {};
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

class MockCompressionAdapter {
  isSupported = vi.fn(() => true);

  deflate = vi.fn(async (chunk: Uint8Array) => chunk);

  inflate = vi.fn(async (chunk: Uint8Array, originalByteLength: number) => {
    if (originalByteLength === 5) {
      return new Uint8Array([1, 2, 3, 4, 5]);
    }

    return chunk;
  });
}

function createStoreAdapter(): TransferStoreAdapter {
  return {
    setConnected: vi.fn(),
    setSignalingStatus: vi.fn(),
    setSignalingLatency: vi.fn(),
    setPeerStatus: vi.fn(),
    setConnectionStage: vi.fn(),
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
  size: 8,
  name: "hello.txt",
  chunkSize: 5,
  totalChunks: 2,
  compressionMode: "adaptive-deflate-v1",
};

describe("ReceiverSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stores metadata and moves into awaiting-save state", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const createPeerMesh = vi.fn(() => peerMesh as never);
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh,
    });

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);

    expect(signaling.fetchIceServers).toHaveBeenCalledTimes(1);
    expect(createPeerMesh).toHaveBeenCalledWith(
      expect.any(Object),
      "room-123",
      {
        iceServers: mockIceServers,
        sdpSemantics: "unified-plan",
      }
    );
    expect(store.setConnectionStage).toHaveBeenCalledWith("waiting-for-peer");
    expect(store.resetTransfer).toHaveBeenCalled();
    expect(store.setMetadata).toHaveBeenCalledWith(metadata);
    expect(store.setTransferStatus).toHaveBeenCalledWith("awaiting-save");
  });

  it("fails connection setup when the ICE server fetch fails", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    signaling.fetchIceServers = vi.fn(async () => {
      throw new Error("Unable to request ICE servers from the signaling server.");
    });
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.connect("room-123");

    expect(signaling.joinRoom).not.toHaveBeenCalled();
    expect(signaling.dispose).toHaveBeenCalledTimes(1);
    expect(store.setTransferStatus).toHaveBeenCalledWith("failed");
    expect(store.setTransferError).toHaveBeenCalledWith(
      "Unable to request ICE servers from the signaling server."
    );
  });

  it("marks WebRTC startup when the first offer is handled", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.connect("room-123");
    await signaling.trigger("offer", {
      room: "room-123",
      connectionId: 0,
      offer: { type: "offer", sdp: "offer" },
    });

    expect(store.setConnectionStage).toHaveBeenCalledWith("starting-webrtc");
  });

  it("marks ICE checking when the first local candidate is emitted", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.connect("room-123");
    (
      session as unknown as {
        handleLocalIceCandidate: (
          candidate: RTCIceCandidateInit,
          connectionId: number,
          sender: "sender" | "receiver"
        ) => void;
      }
    ).handleLocalIceCandidate({ candidate: "candidate:2" }, 1, "receiver");

    expect(store.setConnectionStage).toHaveBeenCalledWith("checking-ice");
    expect(signaling.emitted).toContainEqual({
      event: "ice-candidate",
      payload: {
        room: "room-123",
        candidate: { candidate: "candidate:2" },
        sender: "receiver",
        connectionId: 1,
      },
    });
  });

  it("starts fallback downloads and notifies the sender", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const fallbackWriter = new MockWriter("blob-fallback");
    const compressionAdapter = new MockCompressionAdapter();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      createFallbackWriter: () => fallbackWriter as never,
      compressionAdapter: compressionAdapter as never,
    });

    vi.spyOn(session, "supportsDirectFileWrite").mockReturnValue(false);

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);
    await session.prepareDownload();

    expect(fallbackWriter.prepare).toHaveBeenCalledWith(metadata);
    expect(signaling.emitted).toContainEqual({
      event: "receiver-ready",
      payload: {
        room: "room-123",
        writeMode: "blob-fallback",
        compressionMode: "adaptive-deflate-v1",
      },
    });
  });

  it("flushes ordered raw and compressed chunks and completes the transfer", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const fallbackWriter = new MockWriter("blob-fallback");
    const compressionAdapter = new MockCompressionAdapter();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      createFallbackWriter: () => fallbackWriter as never,
      compressionAdapter: compressionAdapter as never,
    });

    vi.spyOn(session, "supportsDirectFileWrite").mockReturnValue(false);

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);
    await session.prepareDownload();

    const internal = session as unknown as {
      handleChannelMessage: (
        message: Blob | string | ArrayBuffer | ArrayBufferView
      ) => Promise<void>;
    };

    await internal.handleChannelMessage(
      createDataFrame(1, new Uint8Array([9, 9]), "deflate", 5)
    );
    await internal.handleChannelMessage(
      createDataFrame(0, new Uint8Array([1, 2, 3]), "raw")
    );
    await (session as unknown as {
      handleDataMessage: (message: unknown) => Promise<void>;
    }).handleDataMessage({
      type: "complete",
      totalChunks: 2,
    });
    await (session as unknown as {
      transferSession: { flushPromise: Promise<void> };
    }).transferSession.flushPromise;

    expect(fallbackWriter.writeChunk).toHaveBeenCalledTimes(2);
    expect(fallbackWriter.writeChunk).toHaveBeenNthCalledWith(
      1,
      new Uint8Array([1, 2, 3])
    );
    expect(fallbackWriter.writeChunk).toHaveBeenNthCalledWith(
      2,
      new Uint8Array([1, 2, 3, 4, 5])
    );
    expect(fallbackWriter.finalize).toHaveBeenCalled();
    expect(signaling.emitted).toContainEqual({
      event: "received",
      payload: {
        room: "room-123",
        logicalBytesReceived: 8,
        wireBytesReceived: 33,
      },
    });
    expect(signaling.emitted).toContainEqual({
      event: "transfer-complete",
      payload: { room: "room-123" },
    });
  });

  it("fails the transfer when decompression fails", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const fallbackWriter = new MockWriter("blob-fallback");
    const compressionAdapter = new MockCompressionAdapter();
    compressionAdapter.inflate = vi.fn(async () => {
      throw new Error("bad deflate");
    });
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      createFallbackWriter: () => fallbackWriter as never,
      compressionAdapter: compressionAdapter as never,
    });

    vi.spyOn(session, "supportsDirectFileWrite").mockReturnValue(false);

    await session.connect("room-123");
    await signaling.trigger("metadata", metadata);
    await session.prepareDownload();

    await (session as unknown as {
      handleChannelMessage: (
        message: Blob | string | ArrayBuffer | ArrayBufferView
      ) => Promise<void>;
    }).handleChannelMessage(createDataFrame(0, new Uint8Array([9, 9]), "deflate", 5));

    expect(store.setTransferStatus).toHaveBeenCalledWith("failed");
    expect(store.setTransferError).toHaveBeenCalledWith("bad deflate");
  });

  it("surfaces invalid share codes from join rejection", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.connect("room-123");
    await signaling.trigger("join-rejected", {
      room: "room-123",
      reason: "sender-not-found",
    });

    expect(store.setTransferStatus).toHaveBeenCalledWith("failed");
    expect(store.setTransferError).toHaveBeenCalledWith(
      "Share code not found or already expired."
    );
    expect(signaling.dispose).toHaveBeenCalledTimes(1);
  });

  it("clears the recovery timer when peer transport reconnects", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new ReceiverSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.connect("room-123");
    await signaling.trigger("peer-transport-state", {
      room: "room-123",
      role: "sender",
      state: "disconnected",
    });
    vi.advanceTimersByTime(5000);
    await signaling.trigger("peer-transport-state", {
      room: "room-123",
      role: "sender",
      state: "connected",
    });
    vi.advanceTimersByTime(10000);

    expect(store.setTransferError).not.toHaveBeenCalledWith(
      "Peer-to-peer connection was lost and could not be recovered."
    );
  });
});
