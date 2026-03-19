import { useEffect, useState } from "react";
import { createTransferStoreAdapter } from "../utils/transport/storeAdapter";
import SenderSession from "../utils/transport/senderSession";

const MAX_SERVER_RETRIES = 5;

export function useSenderSession() {
  const [session, setSession] = useState<SenderSession | null>(() => new SenderSession(createTransferStoreAdapter()));
  const [roomId, setRoomId] = useState("");
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    let retryTimeout: number | null = null;
    let attempt = 0;
    let lastErrorMessage: string | null = null;

    const scheduleRetry = () => {
      if (attempt >= MAX_SERVER_RETRIES) {
        setInitError(
          lastErrorMessage ||
            "Unable to reach the signaling server. Check that the backend is running and try again."
        );
        return;
      }

      attempt += 1;
      retryTimeout = window.setTimeout(() => {
        void initialize();
      }, Math.min(1000 * attempt, 5000));
    };

    const initialize = async () => {
      try {
        const result = await session.init();
        if (!cancelled) {
          setRoomId(result.roomId);
          setInitError(null);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown sender initialization error.";
        lastErrorMessage = message;
        const isServerReachabilityError =
          message.includes("signaling server") ||
          message.includes("room id");

        if (isServerReachabilityError) {
          scheduleRetry();
          return;
        }

        setInitError(message);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (retryTimeout != null) {
        window.clearTimeout(retryTimeout);
      }
      session.dispose();
    };
  }, [session]);

  return {
    session,
    roomId,
    initError,
    retry: () => {
      setRoomId("");
      setInitError(null);
      setSession(new SenderSession(createTransferStoreAdapter()));
    },
  };
}
