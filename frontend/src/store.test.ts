import { beforeEach, describe, expect, it } from "vitest";
import { useTransferStore } from "./store";

describe("transfer store", () => {
  beforeEach(() => {
    useTransferStore.setState(useTransferStore.getInitialState(), true);
  });

  it("preserves connection state when resetting transfer", () => {
    useTransferStore.getState().setConnected(true);
    useTransferStore.getState().setTransferStatus("failed");
    useTransferStore.getState().setTransferError("boom");

    useTransferStore.getState().resetTransfer();

    expect(useTransferStore.getState().isConnected).toBe(true);
    expect(useTransferStore.getState().transferStatus).toBe("idle");
    expect(useTransferStore.getState().error).toBeNull();
  });

  it("marks receive started based on the current write mode", () => {
    useTransferStore.getState().setWriteMode("blob-fallback");
    useTransferStore.getState().markReceiveStarted();
    expect(useTransferStore.getState().transferStatus).toBe("fallback-buffering");

    useTransferStore.getState().setWriteMode("stream");
    useTransferStore.getState().markReceiveStarted();
    expect(useTransferStore.getState().transferStatus).toBe("streaming-direct-write");
  });

  it("updates reorder metrics explicitly", () => {
    useTransferStore.getState().setReorderMetrics(5, 11);

    expect(useTransferStore.getState().reorderBufferSize).toBe(5);
    expect(useTransferStore.getState().highestContiguousWrittenIndex).toBe(11);
  });
});
