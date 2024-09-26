import React, { useEffect, useState } from "react";
import { Sender } from "./utils/connection";
import Dropzone from "react-dropzone";
import store from "./store";
import { motion } from "framer-motion";
import ToastNotification from "./components/toastNoti";
import { Grid } from "react-loader-spinner";
import Loader from "./components/loader";
import dataFormatHandler from "./utils/dataFormatHandler";
import { LinearProgress } from "@mui/material";
import GitHubLink from "./components/githublink";
const shortener = (str) => {
  if (str.length > 20) {
    return str.slice(0, 20) + "...";
  }
  return str;
};

export default function Send() {
  const [connection, setConnection] = useState(null);
  const [uniqueId, setUniqueId] = useState("");
  const [file, setFile] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSending, setSending] = useState(false);
  const [sizeReceived, setSizeReceived] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
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
  store.subscribe(() => {
    setIsConnected(store.getState().key.isConnected);
    setSizeReceived(store.getState().key.sizeReceived * 128);
  });

  useEffect(() => {
    if (isModalVisible) {
      setTimeout(() => {
        setIsModalVisible(false);
      }, 1500);
    }
  }, [isModalVisible]);

  if (!uniqueId) {
    return (
      <div className="w-screen h-screen bg-black font-mono text-center text-white text-2xl flex flex-col justify-center items-center gap-6">
        <Loader />
        <p>Waiting for server</p>
      </div>
    );
  }
  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };
  const handleSend = async () => {
    if (file) {
      setSending(true);
      setTotalSize(file.size / 1024);
      connection.sendFile(file);
    }
  };
  const copyUniqueID = () => {
    navigator.clipboard.writeText(connection.uniqueId);
    setIsModalVisible(true);
  };
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
          onClick={() => {
            handleSend();
          }}
        >
          Send file
        </motion.button>
      </div>
      {isSending && (
        <>
          <div className=" m-auto mt-10 w-3/5 ">
            <LinearProgress
              variant="determinate"
              value={(100 * sizeReceived) / totalSize}
            />
          </div>
        </>
      )}
      <GitHubLink />
      {
        <ToastNotification
          isModalVisible={isModalVisible}
          text="Share Code copied"
        />
      }
    </div>
  );
}
