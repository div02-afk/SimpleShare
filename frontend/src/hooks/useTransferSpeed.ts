import { useEffect, useRef, useState } from "react";
import type { TransferStatus } from "../types/transfer";

const ACTIVE_TRANSFER_STATUSES = new Set<TransferStatus>([
  "streaming-direct-write",
  "fallback-buffering",
]);

export function useTransferSpeed(
  progressBytes: number,
  transferStatus: TransferStatus
): number {
  const [transferSpeed, setTransferSpeed] = useState(0);
  const progressBytesRef = useRef(progressBytes);

  useEffect(() => {
    progressBytesRef.current = progressBytes;
  }, [progressBytes]);

  useEffect(() => {
    if (!ACTIVE_TRANSFER_STATUSES.has(transferStatus)) {
      return;
    }

    let previousBytes = progressBytesRef.current;
    let previousTime = Date.now();

    const interval = window.setInterval(() => {
      const now = Date.now();
      const deltaBytes = progressBytesRef.current - previousBytes;
      const deltaTime = now - previousTime;

      setTransferSpeed(
        deltaTime > 0 ? Math.max(0, (deltaBytes * 1000) / deltaTime) : 0
      );

      previousBytes = progressBytesRef.current;
      previousTime = now;
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [transferStatus]);

  return ACTIVE_TRANSFER_STATUSES.has(transferStatus) ? transferSpeed : 0;
}

export default useTransferSpeed;
