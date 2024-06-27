import React, { useEffect, useState } from "react";
import { Sender } from "./utils/connection";
import Dropzone from "react-dropzone";
import store from "./store";
import { motion } from "framer-motion";
import ToastNotification from "./components/toastNoti";
export default function Send() {
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [file, setFile] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  useEffect(() => {
    const conn = new Sender();
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
    
    setIsConnected(store.getState().key.isConnected);
  });

  useEffect(() => {
    if (isModalVisible) {
      setTimeout(() => {
        setIsModalVisible(false);
      }, 1500);
    }
  }, [isModalVisible]);

  if (!connection || !uniqueId) {
    return <p>Waiting for uniqueId</p>;
  }
  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };
  const handleSend = async () => {
    console.log("Sending file",file);
    if (file) {
      connection.sendFile(file);
    }
  };
  const copyUniqueID = () => {
    navigator.clipboard.writeText(connection.uniqueId);
    setIsModalVisible(true);
  };
  return (
    <div className="bg-black text-white h-screen">
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
      {isConnected && (
        <div>
          <p className="text-center">Connected</p>
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
              className="h-44 bg-gray-500 w-[50%] rounded-2xl"
            >
              <input {...getInputProps()} className=""/>
              <div className="mt-10 "></div>
              {file ? (
                <p className="text-center text-xl">{file.name}</p>
              ) : (
                <p className="text-center text-xl">
                  Drag 'n' drop some files here, or click to select files
                </p>
              )}
            </div>
          </div>
        )}
      </Dropzone>
      ;
      <div className="w-screen flex items-center justify-center ">
        <motion.button
          disabled={!isConnected}
          whileHover={(isConnected &&file) &&{ scale: 1.5 }}
          className="bg-blue-500 p-2 rounded-2xl disabled:bg-blue-300"
          onClick={() => {
            handleSend();
          }}
        >
          Send file
        </motion.button>
      </div>
      {
        <ToastNotification isModalVisible={isModalVisible} text = "Share Code copied"/>
      }
    </div>
    // <div className="send">
    //   <h1>Send</h1>
    //   <p>{isConnected ? "connection successful" : "not connected"}</p>
    //   <p>Welcome to the send page!</p>
    //   <p>{uniqueId}</p>
    //   <input type="file" onChange={handleFileChange} />
    //   <button disabled={!isConnected} onClick={handleSend}>
    //     Send
    //   </button>
    //   <div className="w-[50%]">
    //     <FileInputComponent />
    //   </div>
    // </div>
  );
}
