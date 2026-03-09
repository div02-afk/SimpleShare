import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTransferSpeed } from "./useTransferSpeed";

describe("useTransferSpeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero outside active transfer states", () => {
    const { result } = renderHook(() => useTransferSpeed(10, "idle"));
    expect(result.current).toBe(0);
  });

  it("calculates bytes per second during active transfer states", () => {
    const { result, rerender } = renderHook(
      ({ progress, status }) => useTransferSpeed(progress, status),
      {
        initialProps: {
          progress: 0,
          status: "streaming-direct-write" as const,
        },
      }
    );

    act(() => {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      vi.advanceTimersByTime(1000);
      rerender({ progress: 1024, status: "streaming-direct-write" });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(1024);
  });
});
