import { LinearProgress } from "@mui/material";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import Dropzone from "react-dropzone";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import { useTransferStore } from "./store";
import ToastNotification from "./components/toastNoti";
import { Sender } from "./utils/connection";
import dataFormatHandler, {
  transferRateFormatHandler,
} from "./utils/dataFormatHandler";

const shortener = (str) => {
  if (str.length > 20) {
    return str.slice(0, 20) + "...";
  }
  return str;
};

const getTransferMessage = (transferStatus, writeMode, error) => {
  if (transferStatus === "awaiting-receiver") {
    return "Waiting for receiver to choose a destination";
  }

  if (transferStatus === "streaming-direct-write") {
    if (writeMode === "blob-fallback") {
      return "Receiver is buffering the download in-browser";
    }

    return "Receiver is saving directly to a file";
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

export default function Send() {
  const isConnected = useTransferStore((state) => state.isConnected);
  const sizeReceived = useTransferStore((state) => state.sizeReceived);
  const transferSize = useTransferStore((state) => state.transferSize);
  const transferStatus = useTransferStore((state) => state.transferStatus);
  const transferError = useTransferStore((state) => state.error);
  const writeMode = useTransferStore((state) => state.writeMode);
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [file, setFile] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [transferSpeed, setTransferSpeed] = useState(0);
  const sizeReceivedRef = useRef(0);

  useEffect(() => {
    const conn = new Sender();
    setConnection(conn);
    const checkUniqueId = () => {
      if (conn.isUniqueIDSet) {
        setUniqueId(conn.uniqueId);
      } else {
        setTimeout(checkUniqueId, 100);
      }
    };
    checkUniqueId();
  }, []);

  useEffect(() => {
    if (isModalVisible) {
      setTimeout(() => {
        setIsModalVisible(false);
      }, 1500);
    }
  }, [isModalVisible]);

  useEffect(() => {
    sizeReceivedRef.current = sizeReceived;
  }, [sizeReceived]);

  useEffect(() => {
    if (
      transferStatus === "idle" ||
      transferStatus === "awaiting-receiver" ||
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

  if (!uniqueId) {
    return (
      <div className="w-screen h-screen bg-black font-mono text-center text-white text-2xl flex flex-col justify-center items-center gap-6">
        <Loader />
        <p>Waiting for server</p>
      </div>
    );
  }

  const handleSend = () => {
    if (file && connection) {
      connection.sendFile(file);
    }
  };

  const copyUniqueID = () => {
    navigator.clipboard.writeText(connection.uniqueId);
    setIsModalVisible(true);
  };

  const transferMessage = getTransferMessage(
    transferStatus,
    writeMode,
    transferError
  );
  const totalSize = transferSize || file?.size || 0;
  const showProgress = transferStatus !== "idle";
  const showSpeed =
    transferStatus === "streaming-direct-write" ||
    transferStatus === "fallback-buffering";

  return (
    <div className="bg-black text-white h-screen pt-2 font-mono">
      <div className="mb-20">
        <h1 className="text-center text-3xl mb-20">Send Anything</h1>
        <p className="text-center">
          Share this to the receiver <br />
          <span
            onClick={() => {
              copyUniqueID();
            }}
            className=" hover:text-red-600 text-2xl cursor-pointer"
          >
            {connection.uniqueId}
          </span>
        </p>
      </div>
      {isConnected ? (
        <div>
          <p className="text-center">Connected</p>
        </div>
      ) : (
        <div>
          <p className="text-center">Waiting for a connection</p>
        </div>
      )}
      <Dropzone
        onDrop={(acceptedFiles) => {
          setFile(acceptedFiles[0]);
        }}
      >
        {({ getRootProps, getInputProps }) => (
          <div className="w-full flex items-center justify-center">
            <div
              {...getRootProps()}
              className="h-44 bg-gray-500 w-[70%] max-w-[600px] rounded-2xl"
            >
              <input {...getInputProps()} className="" />
              <div className="mt-10 "></div>
              {file ? (
                <p className="text-center text-xl">{shortener(file.name)}</p>
              ) : (
                <p className="text-center text-xl">
                  Drag 'n' drop some files here, or click to select files
                </p>
              )}
            </div>
          </div>
        )}
      </Dropzone>

      <div className="w-screen flex items-center justify-center pt-10">
        <motion.button
          disabled={!isConnected || !file}
          whileHover={isConnected && file && { scale: 1.5 }}
          className="bg-blue-500 p-2 rounded-2xl disabled:bg-blue-300 px-10"
          onClick={handleSend}
        >
          Send file
        </motion.button>
      </div>
      {showProgress && (
        <div className="m-auto mt-10 w-3/5">
          <LinearProgress
            variant="determinate"
            value={
              totalSize ? Math.min((100 * sizeReceived) / totalSize, 100) : 0
            }
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
      <ToastNotification isModalVisible={isModalVisible} text="Share Code copied" />
    </div>
  );
}
