import { create } from "zustand";
import type { TransferActions, TransferState, TransferStore } from "./types/transfer";

const createTransferState = (): TransferState => ({
  isConnected: false,
  signalingStatus: "connecting",
  signalingLatencyMs: null,
  peerStatus: "waiting",
  connectionStage: "idle",
  sizeReceived: 0,
  bytesWritten: 0,
  transferSize: 0,
  metadata: null,
  transferStatus: "idle",
  writeMode: null,
  error: null,
  resolvedFileName: null,
  reorderBufferSize: 0,
  highestContiguousWrittenIndex: -1,
});

export const useTransferStore = create<TransferStore>((set) => ({
  ...createTransferState(),
  setConnected: (isConnected = true) => {
    set({ isConnected });
  },
  setSignalingStatus: (signalingStatus) => {
    set({ signalingStatus });
  },
  setSignalingLatency: (signalingLatencyMs) => {
    set({ signalingLatencyMs });
  },
  setPeerStatus: (peerStatus) => {
    set({ peerStatus });
  },
  setConnectionStage: (connectionStage) => {
    set({ connectionStage });
  },
  setMetadata: (metadata) => {
    set({ metadata });
  },
  setSizeReceived: (sizeReceived) => {
    set({ sizeReceived });
  },
  setBytesWritten: (bytesWritten) => {
    set({ bytesWritten });
  },
  setTransferStatus: (transferStatus) => {
    set({ transferStatus });
  },
  setWriteMode: (writeMode) => {
    set({ writeMode });
  },
  setTransferError: (error) => {
    set({ error });
  },
  setResolvedFileName: (resolvedFileName) => {
    set({ resolvedFileName });
  },
  setTransferSize: (transferSize) => {
    set({ transferSize });
  },
  setReorderMetrics: (reorderBufferSize, highestContiguousWrittenIndex) => {
    set({ reorderBufferSize, highestContiguousWrittenIndex });
  },
  markReceiveStarted: () => {
    set((state) => ({
      transferStatus:
        state.writeMode === "blob-fallback"
          ? "fallback-buffering"
          : "streaming-direct-write",
    }));
  },
  updateTransfer: (payload) => {
    set(payload);
  },
  resetTransfer: () => {
    set((state) => ({
      ...createTransferState(),
      isConnected: state.isConnected,
      signalingStatus: state.signalingStatus,
      signalingLatencyMs: state.signalingLatencyMs,
      peerStatus: state.peerStatus,
      connectionStage: state.connectionStage,
    }));
  },
}));

export type { TransferActions, TransferState, TransferStore };

export default useTransferStore;
