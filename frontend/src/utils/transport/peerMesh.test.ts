import { describe, expect, it, vi } from "vitest";
import PeerMesh from "./peerMesh";

function createMockDataChannel() {
  return {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    binaryType: "arraybuffer",
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onopen: null,
    onclose: null,
    onmessage: null,
  } as unknown as RTCDataChannel;
}

function createMockPeerConnection(channel: RTCDataChannel) {
  return {
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(),
    createAnswer: vi.fn(),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    addIceCandidate: vi.fn(),
    close: vi.fn(),
    onicecandidate: null,
    oniceconnectionstatechange: null,
    ondatachannel: null,
    iceConnectionState: "new",
    signalingState: "stable",
  } as unknown as RTCPeerConnection;
}

describe("PeerMesh", () => {
  it("uses frame byte length for global drain accounting", async () => {
    const channel = createMockDataChannel();
    const peerConnection = createMockPeerConnection(channel);
    const mesh = new PeerMesh(
      {
        role: "sender",
        peerConnectionCount: 1,
        dataChannelsPerConnection: 1,
        dataChannelHighWaterMark: 1024,
        dataChannelLowWaterMark: 512,
        totalBufferedHighWaterMark: 4,
        totalBufferedLowWaterMark: 2,
      },
      {
        onIceCandidate: vi.fn(),
        onAllConnected: vi.fn(),
        peerConnectionFactory: vi.fn(() => peerConnection),
      }
    );

    await mesh.sendFrame(new ArrayBuffer(5));

    let resolved = false;
    const waitPromise = mesh.waitForGlobalDrain().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    mesh.noteBytesAcknowledged(3);
    await waitPromise;

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
  });
});
