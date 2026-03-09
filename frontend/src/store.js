import { create } from "zustand";

const createTransferState = () => ({
  isConnected: false,
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

export const useTransferStore = create((set) => ({
  ...createTransferState(),
  setConnected: (isConnected = true) => {
    set({ isConnected });
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
    }));
  },
}));

export default useTransferStore;
