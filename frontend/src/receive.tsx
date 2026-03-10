import { faCircleCheck, faCirclePlus } from "@fortawesome/free-solid-svg-icons";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { LinearProgress } from "@mui/material";
import { useEffect, useState } from "react";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import ToastNotification from "./components/toastNoti";
import { useReceiverSession } from "./hooks/useReceiverSession";
import { useTransferSpeed } from "./hooks/useTransferSpeed";
import { useTransferStore } from "./store";
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

export default function Receive() {
  const sizeReceived = useTransferStore((state) => state.sizeReceived);
  const bytesWritten = useTransferStore((state) => state.bytesWritten);
  const isConnected = useTransferStore((state) => state.isConnected);
  const metadata = useTransferStore((state) => state.metadata);
  const transferStatus = useTransferStore((state) => state.transferStatus);
  const writeMode = useTransferStore((state) => state.writeMode);
  const transferError = useTransferStore((state) => state.error);
  const resolvedFileName = useTransferStore(
    (state) => state.resolvedFileName
  );
  const { session, connect } = useReceiverSession();
  const [uniqueId, setUniqueId] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
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
      setIsModalVisible(true);
    }, 0);
    const hideTimeout = window.setTimeout(() => {
      setIsModalVisible(false);
    }, 1500);

    return () => {
      window.clearTimeout(showTimeout);
      window.clearTimeout(hideTimeout);
    };
  }, [isConnected]);

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
    if (uniqueId.length < 4) {
      return;
    }

    setIsLoading(true);
    await connect(uniqueId);
  };

  const transferMessage = getReceiverMessage(
    transferStatus,
    writeMode,
    transferError
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
    <div className="min-h-screen w-screen bg-black pb-10 text-center text-white">
      <div className="mb-20 bg-transparent text-3xl">
        <h1 className="pt-10">Receive Anything</h1>
      </div>

      <form
        className="m-auto flex w-80 justify-between rounded-2xl border-2 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConnect();
        }}
      >
        <input
          className="bg-transparent outline-none"
          value={uniqueId}
          onChange={(event) => {
            setUniqueId(event.target.value);
          }}
          type="text"
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

      {isConnected && transferStatus === "idle" && (
        <div className="mt-10">
          <p className="text-2xl">Waiting for sender</p>
        </div>
      )}

      {metadata && (
        <div className="mt-10 flex flex-col items-center gap-4">
          <p className="text-2xl">File: {metadata.name}</p>
          <p className="text-xl">File Size: {dataFormatHandler(totalSize)}</p>
          {resolvedFileName && (
            <p className="text-sm text-gray-400">Saving as: {resolvedFileName}</p>
          )}
          {writeMode && (
            <p className="text-sm uppercase tracking-[0.3em] text-gray-400">
              {writeMode === "stream" ? "Direct To File" : "Browser Fallback"}
            </p>
          )}
          {transferMessage && (
            <p
              className={`max-w-xl px-6 ${
                transferStatus === "failed" ? "text-red-400" : "text-gray-300"
              }`}
            >
              {transferMessage}
            </p>
          )}
          {canStartTransfer && (
            <button
              onClick={() => {
                void session?.prepareDownload();
              }}
              className="rounded-2xl bg-blue-500 px-8 py-3"
            >
              {canPickDirectFile ? "Save as..." : "Start download"}
            </button>
          )}
        </div>
      )}

      {showProgress && (
        <div className="mt-10">
          <p className="text-2xl">
            Received:{" "}
            <span className="inline-block px-2">
              {dataFormatHandler(sizeReceived)}
            </span>
          </p>
          {showWrittenBytes && (
            <p className="mt-2 text-gray-300">
              Written: {dataFormatHandler(bytesWritten)} /{" "}
              {dataFormatHandler(totalSize)}
            </p>
          )}
          {showSpeed && (
            <p className="mt-2 text-gray-300">
              Speed: {transferRateFormatHandler(transferSpeed)}
            </p>
          )}
          <div className="px-8 pt-6 md:px-32">
            <LinearProgress
              variant="determinate"
              value={totalSize ? Math.min((100 * progressBytes) / totalSize, 100) : 0}
            />
          </div>
        </div>
      )}

      {transferStatus === "failed" && transferError && (
        <div className="mt-8 text-red-400">{transferError}</div>
      )}

      <GitHubLink />
      <ToastNotification
        isModalVisible={isModalVisible}
        text="Connection Successful"
      />
      <ToastNotification
        isModalVisible={isTransferCompleteVisible}
        text="Transfer Complete"
      />
    </div>
  );
}
