import React, { useEffect, useState } from "react";
import { Receiver } from "./utils/connection";
import store from "./utils/store";
import peerConnection from "./utils/peerConnectionSetup";
export default function Send() {
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [sizeReceived, setSizeReceived] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const connect = () => {
    const conn = new Receiver( uniqueId);
    setConnection(conn);
  };
  store.subscribe(() => {
    setSizeReceived(store.getState().key.sizeReceived);
    setIsConnected(store.getState().key.isConnected);
  });

  return (
    <div className="receive">
      <h1>Receive</h1>
      <p>Welcome to the receive page!</p>
      <input
        value={uniqueId}
        onChange={(e) => {
          setUniqueId(e.target.value);
        }}
        placeholder="Unique id"
      ></input>
      <button
        onClick={() => {
          connect();
        }}
      >
        Receive
      </button>
      <p> {isConnected ? "connection successful" : "not connected"}</p>
      {sizeReceived < 1024 ? (
        <p>{sizeReceived} KB received </p>
      ) : (
        <p>{sizeReceived / 1024} MB received </p>
      )}
    </div>
  );
}
