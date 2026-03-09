import { useEffect, useRef, useState } from "react";
import { createTransferStoreAdapter } from "../utils/transport/storeAdapter";
import SenderSession from "../utils/transport/senderSession";

const MAX_SERVER_RETRIES = 5;

export function useSenderSession() {
  const sessionRef = useRef<SenderSession | null>(null);
  const [roomId, setRoomId] = useState("");
  const [initError, setInitError] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: number | null = null;
    let attempt = 0;
    let lastErrorMessage: string | null = null;
    const store = createTransferStoreAdapter();
    const session = new SenderSession(store);
    sessionRef.current = session;
    setRoomId("");
    setInitError(null);

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
      sessionRef.current = null;
    };
  }, [retrySeed]);

  return {
    session: sessionRef.current,
    roomId,
    initError,
    retry: () => {
      setRetrySeed((value) => value + 1);
    },
  };
}

export default useSenderSession;
