import { faCircleCheck, faCirclePlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { LinearProgress } from "@mui/material";
import { useEffect, useState } from "react";
import GitHubLink from "./components/githublink";
import Loader from "./components/loader";
import ToastNotification from "./components/toastNoti";
import store from "./store";
import { Receiver } from "./utils/connection";
import dataFormatHandler from "./utils/dataFormatHandler";

export default function Send() {
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [sizeReceived, setSizeReceived] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [isLoading, setisLoading] = useState(false);
  const connect = () => {
    console.log("Connecting",uniqueId);
    if (uniqueId.length < 4) return;
    console.log("Connecting");
    setisLoading(true);
    const conn = new Receiver(uniqueId);
    setConnection(conn);
  };

  useEffect(() => {
    const syncFromStore = () => {
      const { sizeReceived: receivedBytes, isConnected: connected, metadata } =
        store.getState().key;

      setSizeReceived(receivedBytes);
      setIsConnected(connected);
      setTotalSize(metadata?.size ?? 0);

      if (connected) {
        setisLoading(false);
      }
    };

    syncFromStore();
    const unsubscribe = store.subscribe(syncFromStore);
    return unsubscribe;
  }, []);
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
    const handleKeyPress = (e) => {
      if (e.key === "Enter") {
        connect();
      }
    };

    addEventListener("keypress", handleKeyPress);

    return () => {
      removeEventListener("keypress", handleKeyPress);
    };
  }, []);
  return (
    <div className="w-screen h-screen text-center bg-black text-white">
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
      {sizeReceived > 0 ? (
        <>
          <div className="mt-10">
            <p className="text-2xl">
              File Size: {dataFormatHandler(totalSize)}
            </p>
            <p className="text-2xl">
              Received:{" "}
              <div className="p-10">{dataFormatHandler(sizeReceived)}</div>
            </p>
            <div className="p-32">
              <LinearProgress
                variant="determinate"
                value={totalSize ? Math.min((100 * sizeReceived) / totalSize, 100) : 0}
              />
            </div>
          </div>
        </>
      ) : (
        isConnected && (
          <>
            <div className="mt-10">
              <p className="text-2xl">Waiting for sender</p>
            </div>
          </>
        )
      )}<GitHubLink />
      <ToastNotification
        isModalVisible={isModalVisible}
        text="Connection Successful"
      />
    </div>
  );
}
