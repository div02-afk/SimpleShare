import { faCircleCheck, faCirclePlus } from "@fortawesome/free-solid-svg-icons";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { LinearProgress } from "@mui/material";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import ToastNotification from "./components/toastNoti";
import { useReceiverSession } from "./hooks/useReceiverSession";
import { useTransferSpeed } from "./hooks/useTransferSpeed";
import { useTransferStore } from "./store";
import type {
  ConnectionStage,
  PeerStatus,
  SignalingStatus,
} from "./types/transfer";
import dataFormatHandler, {
  transferRateFormatHandler,
} from "./utils/dataFormatHandler";

const getReceiverMessage = (
  transferStatus: ReturnType<typeof useTransferStore.getState>["transferStatus"],
  writeMode: ReturnType<typeof useTransferStore.getState>["writeMode"],
  error: string | null
) => {
  if (transferStatus === "awaiting-save") {
    return "File metadata received. Choose where to save before transfer starts.";
  }

  if (transferStatus === "streaming-direct-write") {
    return "Saving directly to file.";
  }

  if (transferStatus === "fallback-buffering") {
    return "Browser fallback active. Buffering file in memory before download.";
  }

  if (transferStatus === "finalizing-write") {
    return writeMode === "stream"
      ? "All bytes received. Finishing the file write."
      : "All bytes received. Preparing the browser download.";
  }

  if (transferStatus === "completed") {
    return "Transfer completed.";
  }

  if (transferStatus === "failed") {
    return error || "Transfer failed.";
  }

  if (writeMode === "blob-fallback") {
    return "Browser fallback active.";
  }

  return null;
};

const getConnectionMessage = (
  signalingStatus: SignalingStatus,
  peerStatus: PeerStatus
) => {
  if (signalingStatus === "disconnected" || peerStatus === "disconnected") {
    return "Disconnected";
  }

  if (signalingStatus === "degraded" || peerStatus === "degraded") {
    return "Degraded, attempting recovery";
  }

  if (peerStatus === "connected") {
    return "Connected";
  }

  return "Waiting for peer";
};

const getConnectionStageMessage = (
  peerStatus: PeerStatus,
  connectionStage: ConnectionStage
) => {
  if (peerStatus !== "waiting") {
    return null;
  }

  if (connectionStage === "starting-webrtc") {
    return "Starting WebRTC/ICE negotiation";
  }

  if (connectionStage === "checking-ice") {
    return "Checking the peer-to-peer network path";
  }

  return null;
};

export default function Receive() {
  const sizeReceived = useTransferStore((state) => state.sizeReceived);
  const bytesWritten = useTransferStore((state) => state.bytesWritten);
  const isConnected = useTransferStore((state) => state.isConnected);
  const signalingStatus = useTransferStore((state) => state.signalingStatus);
  const signalingLatencyMs = useTransferStore(
    (state) => state.signalingLatencyMs
  );
  const peerStatus = useTransferStore((state) => state.peerStatus);
  const connectionStage = useTransferStore((state) => state.connectionStage);
  const metadata = useTransferStore((state) => state.metadata);
  const transferStatus = useTransferStore((state) => state.transferStatus);
  const writeMode = useTransferStore((state) => state.writeMode);
  const transferError = useTransferStore((state) => state.error);
  const resolvedFileName = useTransferStore(
    (state) => state.resolvedFileName
  );
  const { session, connect } = useReceiverSession();
  const [uniqueId, setUniqueId] = useState("");
  const [inputError, setInputError] = useState("");

  const [isTransferCompleteVisible, setIsTransferCompleteVisible] =
    useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const transferSpeed = useTransferSpeed(sizeReceived, transferStatus);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const showTimeout = window.setTimeout(() => {
      setIsLoading(false);
    }, 0);

    return () => {
      window.clearTimeout(showTimeout);
    };
  }, [isConnected]);

  if (
    isLoading &&
    (transferError ||
      peerStatus !== "waiting" ||
      signalingStatus === "disconnected")
  ) {
    setIsLoading(false);
  }

  useEffect(() => {
    if (transferStatus !== "completed") {
      return;
    }

    const showTimeout = window.setTimeout(() => {
      setIsTransferCompleteVisible(true);
    }, 0);
    const hideTimeout = window.setTimeout(() => {
      setIsTransferCompleteVisible(false);
    }, 2000);

    return () => {
      window.clearTimeout(showTimeout);
      window.clearTimeout(hideTimeout);
    };
  }, [transferStatus]);

  const handleConnect = async () => {
    if (uniqueId.length !== 4) {
      setInputError("Code must be exactly 4 characters");
      return;
    }
    if (!/^[a-z0-9]{4}$/.test(uniqueId)) {
      setInputError("Code can only contain letters and numbers");
      return;
    }

    setInputError("");
    setIsLoading(true);

    posthog.capture("receive_attempted", {
      room_id: uniqueId,
    });
    await connect(uniqueId);
  };

  const transferMessage = getReceiverMessage(
    transferStatus,
    writeMode,
    transferError
  );
  const connectionMessage = getConnectionMessage(signalingStatus, peerStatus);
  const connectionStageMessage = getConnectionStageMessage(
    peerStatus,
    connectionStage
  );
  const totalSize = metadata?.size ?? 0;
  const canPickDirectFile = session?.supportsDirectFileWrite() ?? false;
  const canStartTransfer =
    Boolean(metadata) &&
    Boolean(session) &&
    (transferStatus === "awaiting-save" ||
      (transferStatus === "failed" && sizeReceived === 0 && writeMode == null));
  const showProgress =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering" ||
    transferStatus === "finalizing-write" ||
    transferStatus === "completed";
  const progressBytes = writeMode === "stream" ? bytesWritten : sizeReceived;
  const showWrittenBytes =
    writeMode === "stream" &&
    (transferStatus === "streaming-direct-write" ||
      transferStatus === "finalizing-write" ||
      transferStatus === "completed");
  const showSpeed =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering";

  return (
    <div className="min-h-screen w-screen bg-black pb-10 font-mono text-center text-white relative flex flex-col items-center overflow-x-hidden">
      <div className="absolute left-6 top-6 text-left w-full">
        <Link to="/" className="text-xl font-semibold transition hover:text-gray-300">
          SimpleShare
        </Link>
      </div>

      <div className="mb-12 mt-16 bg-transparent text-3xl w-full">
        <h1 className="pt-2">Receive Anything</h1>
      </div>

      <form
        className="m-auto flex w-80 justify-between rounded-2xl border-2 border-gray-700 bg-gray-900 p-2 transition-all focus-within:border-blue-500 focus-within:bg-gray-800"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConnect();
        }}
      >
        <input
          className="bg-transparent px-2 text-white outline-none placeholder:text-gray-500"
          value={uniqueId}
          onChange={(event) => {
            const val = event.target.value.toLowerCase();
            if (val.length <= 4) {
              setUniqueId(val);
              if (inputError) setInputError("");
            }
          }}
          type="text"
          maxLength={4}
          placeholder="Share Code"
        />
        <button type="submit">
          {isLoading ? (
            <Loader height={20} width={20} />
          ) : (
            <FontAwesomeIcon
              icon={
                (isConnected ? faCircleCheck : faCirclePlus) as unknown as IconProp
              }
              size="xl"
            />
          )}
        </button>
      </form>

      <div className="h-6 mt-2 text-red-500 text-sm">
        <AnimatePresence>
          {inputError && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
            >
              {inputError}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="mb-6 mt-2 flex h-16 flex-col items-center justify-center space-y-1 text-center">
        <p className="text-gray-300">{connectionMessage}</p>
        <AnimatePresence mode="popLayout">
          {connectionStageMessage && (
            <motion.p
              key="stage"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-sm text-gray-500"
            >
              {connectionStageMessage}
            </motion.p>
          )}
          {signalingLatencyMs != null && (
            <motion.p
              key="latency"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-sm text-gray-500"
            >
              Signaling: {signalingLatencyMs} ms
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isConnected && transferStatus === "idle" && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 40 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden"
          >
            <p className="text-2xl text-gray-300">Waiting for sender</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {metadata && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 40 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="flex flex-col items-center gap-4 overflow-hidden"
          >
            <p className="text-2xl text-gray-200">File: {metadata.name}</p>
            <p className="text-xl text-gray-300">File Size: {dataFormatHandler(totalSize)}</p>
            {resolvedFileName && (
              <p className="text-sm text-gray-500">Saving as: {resolvedFileName}</p>
            )}
            {writeMode && (
              <p className="text-sm uppercase tracking-[0.3em] text-gray-500">
                {writeMode === "stream" ? "Direct To File" : "Browser Fallback"}
              </p>
            )}
            <AnimatePresence>
              {transferMessage && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`max-w-xl overflow-hidden px-6 text-center ${transferStatus === "failed" ? "text-red-400" : "text-gray-400"
                    }`}
                >
                  {transferMessage}
                </motion.p>
              )}
            </AnimatePresence>
            {canStartTransfer && (
              <motion.button
                initial={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  void session?.prepareDownload();
                }}
                className="mt-2 rounded-2xl bg-blue-500 p-2 px-10 transition-colors"
              >
                {canPickDirectFile ? "Save as..." : "Start download"}
              </motion.button>
            )}
            <div></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 40 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden"
          >
            <p className="text-2xl text-gray-200">
              Received:{" "}
              <span className="inline-block px-2 text-white">
                {dataFormatHandler(sizeReceived)}
              </span>
            </p>
            <AnimatePresence>
              {showWrittenBytes && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 overflow-hidden text-gray-300"
                >
                  Written: {dataFormatHandler(bytesWritten)} <span className="text-gray-600">/</span>{" "}
                  {dataFormatHandler(totalSize)}
                </motion.p>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {showSpeed && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 text-gray-400 overflow-hidden"
                >
                  Speed: {transferRateFormatHandler(transferSpeed)}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="px-8 pt-6 md:px-32">
              <LinearProgress
                variant="determinate"
                value={totalSize ? Math.min((100 * progressBytes) / totalSize, 100) : 0}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <GitHubLink />

      <ToastNotification
        isModalVisible={isTransferCompleteVisible}
        text="Transfer Complete"
      />
    </div>
  );
}
