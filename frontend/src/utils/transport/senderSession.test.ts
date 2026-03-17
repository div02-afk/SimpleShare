import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFrame } from "./frameProtocol";
import type { TransferStoreAdapter } from "./types";
import SenderSession from "./senderSession";

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

  fetchRoomId = vi.fn(async () => "room-123");

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

  createOffer = vi.fn(async (connectionId: number) => ({ type: "offer", sdp: `${connectionId}` }));

  acceptOffer = vi.fn();

  applyAnswer = vi.fn(async () => {});

  addIceCandidate = vi.fn(async () => {});

  sendFrame = vi.fn(async () => {});

  waitForGlobalDrain = vi.fn(async () => {});

  noteBytesAcknowledged = vi.fn();

  dispose = vi.fn();
}

class MockCompressionAdapter {
  constructor(
    private readonly results: Uint8Array[] = [],
    private readonly supported = true
  ) {}

  private index = 0;

  isSupported = vi.fn(() => this.supported);

  deflate = vi.fn(async (chunk: Uint8Array) => {
    const next = this.results[this.index];
    this.index += 1;
    return next ?? chunk;
  });

  inflate = vi.fn(async (chunk: Uint8Array) => chunk);
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

async function flushMicrotasks(iterations = 20): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function waitForMockCalls(
  mockFn: { mock: { calls: unknown[][] } },
  expectedCalls: number,
  iterations = 200
): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    if (mockFn.mock.calls.length >= expectedCalls) {
      return;
    }

    await Promise.resolve();
  }
}

describe("SenderSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("initializes the room and joins signaling", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const createPeerMesh = vi.fn(() => peerMesh as never);
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh,
    });

    const result = await session.init();

    expect(result.roomId).toBe("room-123");
    expect(signaling.fetchIceServers).toHaveBeenCalledTimes(1);
    expect(createPeerMesh).toHaveBeenCalledWith(
      expect.any(Object),
      "room-123",
      {
        iceServers: mockIceServers,
        sdpSemantics: "unified-plan",
      }
    );
    expect(signaling.joinRoom).toHaveBeenCalledWith({
      room: "room-123",
      role: "sender",
    });
    expect(store.setConnectionStage).toHaveBeenCalledWith("waiting-for-peer");
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

  it("fails initialization when the ICE server fetch fails", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    signaling.fetchIceServers = vi.fn(async () => {
      throw new Error("Unable to request ICE servers from the signaling server.");
    });
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await expect(session.init()).rejects.toThrow(
      "Unable to request ICE servers from the signaling server."
    );
    expect(signaling.joinRoom).not.toHaveBeenCalled();
    expect(signaling.dispose).toHaveBeenCalledTimes(1);
  });

  it("starts offer creation when the room becomes ready", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.init();
    await signaling.trigger("room-ready", { room: "room-123" });

    expect(store.setConnectionStage).toHaveBeenCalledWith("starting-webrtc");
    expect(peerMesh.createOffer).toHaveBeenCalledTimes(2);
    expect(signaling.emitted).toContainEqual({
      event: "offer",
      payload: {
        room: "room-123",
        offer: { type: "offer", sdp: "0" },
        connectionId: 0,
      },
    });
  });

  it("marks ICE checking when the first local candidate is emitted", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.init();
    (
      session as unknown as {
        handleLocalIceCandidate: (
          candidate: RTCIceCandidateInit,
          connectionId: number,
          sender: "sender" | "receiver"
        ) => void;
      }
    ).handleLocalIceCandidate({ candidate: "candidate:1" }, 0, "sender");

    expect(store.setConnectionStage).toHaveBeenCalledWith("checking-ice");
    expect(signaling.emitted).toContainEqual({
      event: "ice-candidate",
      payload: {
        room: "room-123",
        candidate: { candidate: "candidate:1" },
        sender: "sender",
        connectionId: 0,
      },
    });
  });

  it("starts sending frames once the receiver is ready", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const compressionAdapter = new MockCompressionAdapter([
      new Uint8Array([120, 1]),
    ]);
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      compressionAdapter: compressionAdapter as never,
    });

    await session.init();
    await session.sendFile(
      new File([new Uint8Array(2048)], "hello.txt", { type: "text/plain" })
    );
    await signaling.trigger("receiver-ready", {
      room: "room-123",
      writeMode: "stream",
      compressionMode: "adaptive-deflate-v1",
    });
    await waitForMockCalls(peerMesh.sendFrame, 2);

    expect(peerMesh.sendFrame).toHaveBeenCalled();
    expect(store.setTransferStatus).toHaveBeenCalledWith("streaming-direct-write");

    const firstCall = peerMesh.sendFrame.mock.calls[0] as unknown as [
      ArrayBuffer,
      number
    ];
    expect(firstCall).toBeDefined();
    const firstFrame = firstCall[0];
    const parsed = await parseFrame(firstFrame);
    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(parsed.encoding).toBe("deflate");
      expect(parsed.originalByteLength).toBe(2048);
      expect(parsed.wireByteLength).toBe(2);
    }
  });

  it("falls back to raw frames when the receiver does not accept compression", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const compressionAdapter = new MockCompressionAdapter([
      new Uint8Array([120, 1]),
    ]);
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      compressionAdapter: compressionAdapter as never,
    });

    await session.init();
    await session.sendFile(new File(["hello"], "hello.txt", { type: "text/plain" }));
    await signaling.trigger("receiver-ready", {
      room: "room-123",
      writeMode: "stream",
      compressionMode: "none",
    });
    await flushMicrotasks();

    expect(compressionAdapter.deflate).not.toHaveBeenCalled();

    const firstCall = peerMesh.sendFrame.mock.calls[0] as unknown as [
      ArrayBuffer,
      number
    ];
    expect(firstCall).toBeDefined();
    const firstFrame = firstCall[0];
    const parsed = await parseFrame(firstFrame);
    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(parsed.encoding).toBe("raw");
      expect(parsed.originalByteLength).toBe(5);
      expect(parsed.wireByteLength).toBe(5);
    }
  });

  it("disables compression for the remainder of the file when early chunks compress poorly", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const compressionAdapter = new MockCompressionAdapter(
      Array.from({ length: 8 }, () => new Uint8Array(127 * 1024))
    );
    const session = new SenderSession(store, { chunkSize: 128 * 1024 }, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
      compressionAdapter: compressionAdapter as never,
    });

    await session.init();
    await session.sendFile(
      new File([new Uint8Array(9 * 128 * 1024)], "large.txt", {
        type: "text/plain",
      })
    );
    await signaling.trigger("receiver-ready", {
      room: "room-123",
      writeMode: "stream",
      compressionMode: "adaptive-deflate-v1",
    });
    await waitForMockCalls(compressionAdapter.deflate, 8);
    await waitForMockCalls(peerMesh.sendFrame, 10);

    expect(compressionAdapter.deflate).toHaveBeenCalledTimes(8);
    expect(peerMesh.sendFrame).toHaveBeenCalledTimes(10);

    const ninthCall = peerMesh.sendFrame.mock.calls[8] as unknown as [
      ArrayBuffer,
      number
    ];
    expect(ninthCall).toBeDefined();
    const ninthDataFrame = ninthCall[0];
    const parsed = await parseFrame(ninthDataFrame);
    expect(parsed.type).toBe("data");
    if (parsed.type === "data") {
      expect(parsed.encoding).toBe("raw");
      expect(parsed.originalByteLength).toBe(128 * 1024);
    }
  });

  it("clears the recovery timer when the peer transport reconnects", async () => {
    const store = createStoreAdapter();
    const signaling = new MockSignalingClient();
    const peerMesh = new MockPeerMesh();
    const session = new SenderSession(store, {}, {
      createSignalingClient: () => signaling as never,
      createPeerMesh: () => peerMesh as never,
    });

    await session.init();
    await signaling.trigger("peer-transport-state", {
      room: "room-123",
      role: "receiver",
      state: "disconnected",
    });
    vi.advanceTimersByTime(5000);
    await signaling.trigger("peer-transport-state", {
      room: "room-123",
      role: "receiver",
      state: "connected",
    });
    vi.advanceTimersByTime(10000);

    expect(store.setTransferError).not.toHaveBeenCalledWith(
      "Peer-to-peer connection was lost and could not be recovered."
    );
  });
});
