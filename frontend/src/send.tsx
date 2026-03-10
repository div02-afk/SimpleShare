import { LinearProgress } from "@mui/material";
import { motion } from "framer-motion";
import { useState } from "react";
import Dropzone from "react-dropzone";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import ToastNotification from "./components/toastNoti";
import { useSenderSession } from "./hooks/useSenderSession";
import { useTransferSpeed } from "./hooks/useTransferSpeed";
import { useTransferStore } from "./store";
import type { PeerStatus, SignalingStatus } from "./types/transfer";
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

export default function Send() {
  const isConnected = useTransferStore((state) => state.isConnected);
  const signalingStatus = useTransferStore((state) => state.signalingStatus);
  const signalingLatencyMs = useTransferStore(
    (state) => state.signalingLatencyMs
  );
  const peerStatus = useTransferStore((state) => state.peerStatus);
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
  const totalSize = transferSize || file?.size || 0;
  const showProgress = transferStatus !== "idle";
  const showSpeed =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering";

  return (
    <div className="bg-black pt-2 font-mono text-white min-h-screen">
      <div className="mb-10">
        <h1 className="my-10 text-center text-3xl">Send Anything</h1>
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

      <div className="space-y-2 text-center">
        <p>{connectionMessage}</p>
        {signalingLatencyMs != null && (
          <p className="text-sm text-gray-400">Signaling: {signalingLatencyMs} ms</p>
        )}
      </div>

      <Dropzone
        onDrop={(acceptedFiles) => {
          setFile(acceptedFiles[0] ?? null);
        }}
      >
        {({ getRootProps, getInputProps }) => (
          <div className="flex w-full items-center justify-center">
            <div
              {...getRootProps()}
              className="h-44 w-[70%] max-w-150 rounded-2xl bg-gray-500"
            >
              <input {...getInputProps()} />
              <div className="mt-10" />
              {file ? (
                <p className="text-center text-xl">{shortener(file.name)}</p>
              ) : (
                <p className="text-center text-xl">
                  Drag and drop some files here, or click to select files
                </p>
              )}
            </div>
          </div>
        )}
      </Dropzone>

      <div className="flex w-screen items-center justify-center pt-10">
        <motion.button
          disabled={!isConnected || !file}
          {...(isConnected && file ? { whileHover: { scale: 1.5 } } : {})}
          className="rounded-2xl bg-blue-500 p-2 px-10 disabled:bg-blue-300"
          onClick={handleSend}
        >
          Send file
        </motion.button>
      </div>

      {showProgress && (
        <div className="m-auto mt-10 w-3/5">
          <LinearProgress
            variant="determinate"
            value={totalSize ? Math.min((100 * sizeReceived) / totalSize, 100) : 0}
          />
          <p className="mt-4 text-center">
            {dataFormatHandler(sizeReceived)} / {dataFormatHandler(totalSize)}
          </p>
          {showSpeed && (
            <p className="mt-2 text-center text-gray-300">
              Speed: {transferRateFormatHandler(transferSpeed)}
            </p>
          )}
          {transferMessage && (
            <p
              className={`mt-3 text-center ${
                transferStatus === "failed" ? "text-red-400" : "text-gray-300"
              }`}
            >
              {transferMessage}
            </p>
          )}
        </div>
      )}

      <GitHubLink />
      <ToastNotification
        isModalVisible={isModalVisible}
        text="Share Code copied"
      />
    </div>
  );
}
