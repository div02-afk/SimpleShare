import { useTransferStore } from "../../store";
import type { TransferStoreAdapter } from "./types";

export function createTransferStoreAdapter(): TransferStoreAdapter {
  return {
    setConnected: (isConnected) => {
      useTransferStore.getState().setConnected(isConnected);
    },
    setMetadata: (metadata) => {
      useTransferStore.getState().setMetadata(metadata);
    },
    setSizeReceived: (sizeReceived) => {
      useTransferStore.getState().setSizeReceived(sizeReceived);
    },
    setBytesWritten: (bytesWritten) => {
      useTransferStore.getState().setBytesWritten(bytesWritten);
    },
    setTransferStatus: (transferStatus) => {
      useTransferStore.getState().setTransferStatus(transferStatus);
    },
    setWriteMode: (writeMode) => {
      useTransferStore.getState().setWriteMode(writeMode);
    },
    setTransferError: (error) => {
      useTransferStore.getState().setTransferError(error);
    },
    setResolvedFileName: (resolvedFileName) => {
      useTransferStore.getState().setResolvedFileName(resolvedFileName);
    },
    setTransferSize: (transferSize) => {
      useTransferStore.getState().setTransferSize(transferSize);
    },
    setReorderMetrics: (reorderBufferSize, highestContiguousWrittenIndex) => {
      useTransferStore
        .getState()
        .setReorderMetrics(reorderBufferSize, highestContiguousWrittenIndex);
    },
    markReceiveStarted: () => {
      useTransferStore.getState().markReceiveStarted();
    },
    updateTransfer: (payload) => {
      useTransferStore.getState().updateTransfer(payload);
    },
    resetTransfer: () => {
      useTransferStore.getState().resetTransfer();
    },
  };
}
