import React, { useEffect, useState } from "react";
import { Sender } from "./utils/connection";
import peerConnection from "./utils/peerConnectionSetup";
import store from "./utils/store";
export default function Send() {
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [file, setFile] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  useEffect(() => {
    const conn = new Sender(peerConnection);
    setConnection(conn);

    const checkUniqueId = () => {
      if (conn.isUniqueIDSet === true) {
        setUniqueId(conn.uniqueId);
      } else {
        setTimeout(checkUniqueId, 100); // Retry after 100ms
      }
    };

    checkUniqueId();
  }, []);
  store.subscribe(() => {
    setIsConnected(store.getState().isConnected);
  })
  if (!connection || !uniqueId) {
    return <p>Waiting for uniqueId</p>;
  }
  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };
  const handleSend = async () => {
    if (file) {


      
      connection.sendFile(file);
    }
  };

  return (
    <div className="send">
      <h1>Send</h1>
      <p>{isConnected ? "connection successful" : "not connected"}</p>
      <p>Welcome to the send page!</p>
      <p>{uniqueId}</p>
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
