import { act, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useSenderSession } from "./useSenderSession";

const mocks = vi.hoisted(() => {
  class MockSenderSession {
    disposed = false;

    init = vi.fn(async () => {
      if (this.disposed) {
        throw new Error("Sender session has been disposed.");
      }

      return { roomId: "room-123" };
    });

    sendFile = vi.fn(async () => {});

    dispose = vi.fn(() => {
      this.disposed = true;
    });
  }

  return {
    MockSenderSession,
    instances: [] as MockSenderSession[],
  };
});

vi.mock("../utils/transport/storeAdapter", () => ({
  createTransferStoreAdapter: vi.fn(() => ({})),
}));

vi.mock("../utils/transport/senderSession", () => ({
  default: class MockedSenderSession extends mocks.MockSenderSession {
    constructor() {
      super();
      mocks.instances.push(this);
    }
  },
}));

describe("useSenderSession", () => {
  it("creates a fresh sender session during StrictMode effect re-runs", async () => {
    mocks.instances.length = 0;
    const container = document.createElement("div");
    const root = createRoot(container, {
      unstable_strictMode: true,
    } as Parameters<typeof createRoot>[1]);
    const snapshots: Array<ReturnType<typeof useSenderSession>> = [];

    function Harness() {
      const value = useSenderSession();
      snapshots.push(value);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1]?.roomId).toBe("room-123");
    });

    expect(snapshots[snapshots.length - 1]?.initError).toBeNull();
    expect(mocks.instances).toHaveLength(2);
    expect(mocks.instances[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.instances[1]?.init).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
