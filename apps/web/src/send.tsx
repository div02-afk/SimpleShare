import { LinearProgress } from "@mui/material";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import Dropzone from "react-dropzone";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import ToastNotification from "./components/toastNoti";
import { useSenderSession } from "./hooks/useSenderSession";
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
import serverAddress from "./utils/serverLink";

const shortener = (value: string) =>
  value.length > 20 ? `${value.slice(0, 20)}...` : value;

const getTransferMessage = (
  transferStatus: ReturnType<typeof useTransferStore.getState>["transferStatus"],
  writeMode: ReturnType<typeof useTransferStore.getState>["writeMode"],
  error: string | null
) => {
  if (transferStatus === "awaiting-receiver") {
    return "Waiting for receiver to choose a destination";
  }

  if (transferStatus === "streaming-direct-write") {
    return writeMode === "blob-fallback"
      ? "Receiver is buffering the download in-browser"
      : "Receiver is saving directly to a file";
  }

  if (transferStatus === "fallback-buffering") {
    return "Receiver is buffering the download in-browser";
  }

  if (transferStatus === "completed") {
    return "Transfer completed";
  }

  if (transferStatus === "finalizing-write") {
    return "Receiver has all bytes and is finalizing the saved file";
  }

  if (transferStatus === "failed") {
    return error || "Transfer failed";
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

export default function Send() {
  const isConnected = useTransferStore((state) => state.isConnected);
  const signalingStatus = useTransferStore((state) => state.signalingStatus);
  const signalingLatencyMs = useTransferStore(
    (state) => state.signalingLatencyMs
  );
  const peerStatus = useTransferStore((state) => state.peerStatus);
  const connectionStage = useTransferStore((state) => state.connectionStage);
  const sizeReceived = useTransferStore((state) => state.sizeReceived);
  const transferSize = useTransferStore((state) => state.transferSize);
  const transferStatus = useTransferStore((state) => state.transferStatus);
  const transferError = useTransferStore((state) => state.error);
  const writeMode = useTransferStore((state) => state.writeMode);
  const { session, roomId, initError, retry } = useSenderSession();
  const [file, setFile] = useState<File | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const transferSpeed = useTransferSpeed(sizeReceived, transferStatus);

  if (!roomId && !initError) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-black font-mono text-center text-2xl text-white">
        <Loader />
        <p>Waiting for server</p>
      </div>
    );
  }

  if (!roomId && initError) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-black px-6 font-mono text-center text-white">
        <h1 className="text-3xl">Unable to start sender</h1>
        <p className="max-w-2xl text-red-400">{initError}</p>
        <p className="max-w-2xl text-sm text-gray-400">
          Trying: {serverAddress}/random
        </p>
        <button
          className="rounded-2xl bg-blue-500 px-6 py-3"
          onClick={retry}
        >
          Retry
        </button>
      </div>
    );
  }

  const handleSend = () => {
    if (!file || !session) {
      return;
    }

    posthog.capture("send_attempted", {
      room_id: roomId,
      file_type: file.type,
      file_size_bytes: file.size,
    });
    void session.sendFile(file);
  };

  const copyUniqueId = async () => {
    await navigator.clipboard.writeText(roomId);
    setIsModalVisible(true);
    window.setTimeout(() => {
      setIsModalVisible(false);
    }, 1500);
  };

  const transferMessage = getTransferMessage(
    transferStatus,
    writeMode,
    transferError
  );
  const connectionMessage = getConnectionMessage(signalingStatus, peerStatus);
  const connectionStageMessage = getConnectionStageMessage(
    peerStatus,
    connectionStage
  );
  const totalSize = transferSize || file?.size || 0;
  const showProgress = transferStatus !== "idle";
  const showSpeed =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering";

  return (
    <div className="bg-black pt-2 font-mono text-white min-h-screen relative overflow-hidden flex flex-col items-center">
      <div className="absolute left-6 top-6 text-left">
        <Link to="/" className="text-xl font-semibold transition hover:text-gray-300">
          SimpleShare
        </Link>
      </div>

      <div className="mb-4 mt-16 text-center w-full">
        <h1 className="mb-2 text-3xl">Send Anything</h1>
        <p className="text-center">
          Share this to the receiver <br />
          <span
            onClick={() => {
              void copyUniqueId();
            }}
            className="cursor-pointer text-2xl hover:text-red-600"
          >
            {roomId}
          </span>
        </p>
      </div>

      <div className="mb-6 flex h-16 flex-col items-center justify-center space-y-1 text-center">
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

      <Dropzone
        onDrop={(acceptedFiles) => {
          setFile(acceptedFiles[0] ?? null);
        }}
      >
        {({ getRootProps, getInputProps, isDragActive }) => (
          <div className="flex w-full items-center justify-center border-0 px-6">
            <div
              {...getRootProps()}
              className={`flex h-44 w-[70%] max-w-150 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 transition-all duration-300 ${
                isDragActive
                  ? "scale-[1.02] border-solid border-blue-500 bg-gray-900"
                  : "border-dashed border-gray-700 bg-black hover:border-gray-500 hover:bg-gray-900"
              }`}
            >
              <input {...getInputProps()} />
              {file ? (
                <p className="text-center text-xl text-gray-200">{shortener(file.name)}</p>
              ) : (
                <p className="px-4 text-center text-xl text-gray-400">
                  {isDragActive
                    ? "Drop the file here"
                    : "Drag and drop some files here, or click to select files"}
                </p>
              )}
            </div>
          </div>
        )}
      </Dropzone>

      <div className="flex w-screen items-center justify-center pt-10">
        <motion.button
          disabled={!isConnected || !file}
          {...(isConnected && file ? { whileHover: { scale: 1.2 } } : {})}
          className="rounded-2xl bg-blue-500 p-2 px-10 transition-colors disabled:bg-blue-800 disabled:text-gray-400"
          onClick={handleSend}
        >
          Send file
        </motion.button>
      </div>

      <AnimatePresence>
        {showProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 40 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="m-auto w-3/5 overflow-hidden"
          >
            <LinearProgress
              variant="determinate"
              value={totalSize ? Math.min((100 * sizeReceived) / totalSize, 100) : 0}
            />
            <p className="mt-4 text-center text-gray-300">
              {dataFormatHandler(sizeReceived)} <span className="text-gray-600">/</span> {dataFormatHandler(totalSize)}
            </p>
            <AnimatePresence>
              {showSpeed && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 text-center text-gray-400 overflow-hidden"
                >
                  Speed: {transferRateFormatHandler(transferSpeed)}
                </motion.p>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {transferMessage && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`mt-3 overflow-hidden text-center ${
                    transferStatus === "failed" ? "text-red-400" : "text-gray-400"
                  }`}
                >
                  {transferMessage}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <GitHubLink />
      <ToastNotification
        isModalVisible={isModalVisible}
        text="Share Code copied"
      />
    </div>
  );
}
