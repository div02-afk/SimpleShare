import { faCircleCheck, faCirclePlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { LinearProgress } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import { useTransferStore } from "./store";
import ToastNotification from "./components/toastNoti";
import { Receiver } from "./utils/connection";
import dataFormatHandler, {
  transferRateFormatHandler,
} from "./utils/dataFormatHandler";

const getReceiverMessage = (transferStatus, writeMode, error) => {
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

export default function Send() {
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
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isTransferCompleteVisible, setIsTransferCompleteVisible] = useState(false);
  const [isLoading, setisLoading] = useState(false);
  const [transferSpeed, setTransferSpeed] = useState(0);
  const sizeReceivedRef = useRef(0);

  const connect = () => {
    if (uniqueId.length < 4) return;
    setisLoading(true);
    const conn = new Receiver(uniqueId);
    setConnection(conn);
  };

  const handleStartDownload = async () => {
    if (!connection) {
      return;
    }

    await connection.prepareDownload();
  };

  useEffect(() => {
    if (isConnected) {
      setisLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    if (isModalVisible) {
      setTimeout(() => {
        setIsModalVisible(false);
      }, 1500);
    }
  }, [isModalVisible]);

  useEffect(() => {
    setIsModalVisible(isConnected);
  }, [isConnected]);

  useEffect(() => {
    sizeReceivedRef.current = sizeReceived;
  }, [sizeReceived]);

  useEffect(() => {
    if (transferStatus === "completed") {
      setIsTransferCompleteVisible(true);
      const timeout = setTimeout(() => {
        setIsTransferCompleteVisible(false);
      }, 2000);

      return () => {
        clearTimeout(timeout);
      };
    }
  }, [transferStatus]);

  useEffect(() => {
    if (
      transferStatus === "idle" ||
      transferStatus === "awaiting-save" ||
      transferStatus === "finalizing-write" ||
      transferStatus === "completed" ||
      transferStatus === "failed"
    ) {
      setTransferSpeed(0);
      return;
    }

    let previousBytes = sizeReceivedRef.current;
    let previousTime = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const deltaBytes = sizeReceivedRef.current - previousBytes;
      const deltaTime = now - previousTime;

      setTransferSpeed(
        deltaTime > 0 ? Math.max(0, (deltaBytes * 1000) / deltaTime) : 0
      );

      previousBytes = sizeReceivedRef.current;
      previousTime = now;
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [transferStatus]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Enter") {
        connect();
      }
    };

    addEventListener("keypress", handleKeyPress);

    return () => {
      removeEventListener("keypress", handleKeyPress);
    };
  }, [uniqueId]);

  const transferMessage = getReceiverMessage(
    transferStatus,
    writeMode,
    transferError
  );
  const totalSize = metadata?.size ?? 0;
  const canPickDirectFile = connection?.supportsDirectFileWrite?.() ?? false;
  const canStartTransfer =
    metadata &&
    connection &&
    (transferStatus === "awaiting-save" ||
      (transferStatus === "failed" && sizeReceived === 0 && writeMode == null));
  const showProgress =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering" ||
    transferStatus === "finalizing-write" ||
    transferStatus === "completed";
  const progressBytes =
    writeMode === "stream" ? bytesWritten : sizeReceived;
  const showWrittenBytes =
    writeMode === "stream" &&
    (transferStatus === "streaming-direct-write" ||
      transferStatus === "finalizing-write" ||
      transferStatus === "completed");
  const showSpeed =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering";

  return (
    <div className="w-screen min-h-screen text-center bg-black text-white pb-10">
      <div className="mb-20 text-3xl bg-transparent ">
        <h1 className="pt-10">Receive Anything</h1>
      </div>

      <div className="border-2 w-80 flex justify-between p-2 rounded-2xl m-auto">
        <input
          className="outline-none bg-transparent"
          value={uniqueId}
          onChange={(e) => {
            setUniqueId(e.target.value);
          }}
          type="text"
          placeholder="Share Code"
        ></input>
        <button onClick={connect}>
          {isLoading ? (
            <Loader height={20} width={20} />
          ) : (
            <FontAwesomeIcon
              icon={isConnected ? faCircleCheck : faCirclePlus}
              size="xl"
            />
          )}
        </button>
      </div>

      {isConnected && transferStatus === "idle" && (
        <div className="mt-10">
          <p className="text-2xl">Waiting for sender</p>
        </div>
      )}

      {metadata && (
        <div className="mt-10 flex flex-col gap-4 items-center">
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
                void handleStartDownload();
              }}
              className="bg-blue-500 px-8 py-3 rounded-2xl"
            >
              {canPickDirectFile ? "Save as..." : "Start download"}
            </button>
          )}
        </div>
      )}

      {showProgress && (
        <div className="mt-10">
          <p className="text-2xl">
            Received: <span className="inline-block px-2">{dataFormatHandler(sizeReceived)}</span>
          </p>
          {showWrittenBytes && (
            <p className="mt-2 text-gray-300">
              Written: {dataFormatHandler(bytesWritten)} / {dataFormatHandler(totalSize)}
            </p>
          )}
          {showSpeed && (
            <p className="mt-2 text-gray-300">
              Speed: {transferRateFormatHandler(transferSpeed)}
            </p>
          )}
          <div className="px-8 md:px-32 pt-6">
            <LinearProgress
              variant="determinate"
              value={
                totalSize ? Math.min((100 * progressBytes) / totalSize, 100) : 0
              }
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
