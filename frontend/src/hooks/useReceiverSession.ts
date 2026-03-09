import { useCallback, useEffect, useRef, useState } from "react";
import { createTransferStoreAdapter } from "../utils/transport/storeAdapter";
import ReceiverSession from "../utils/transport/receiverSession";

export function useReceiverSession() {
  const sessionRef = useRef<ReceiverSession | null>(null);
  const [session, setSession] = useState<ReceiverSession | null>(null);

  const connect = useCallback(async (roomId: string) => {
    const nextSession = new ReceiverSession(createTransferStoreAdapter());
    sessionRef.current?.dispose();
    sessionRef.current = nextSession;
    setSession(nextSession);
    await nextSession.connect(roomId);
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  return {
    session,
    connect,
  };
}

export default useReceiverSession;
