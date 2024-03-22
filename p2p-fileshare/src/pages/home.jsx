import React, { useState, useRef, useEffect } from "react";
import socket from "../components/socket";

const checkPeerConnection = (peerConnection, n) => {
  if (peerConnection) {
    console.log("peer connection set at", n);
  } else {
    console.log("peer connection not set at", n);
  }
};

const getRandomString = async () => {
  try {
    const response = await fetch("http://localhost:3000/random");
    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("Error:", error);
    throw error; // Re-throw the error to handle it outside
  }
};

export default function Home() {
  const fileInputRef = useRef();
  const [isSending, setIsSending] = useState(true);
  const [file, setFile] = useState(null);
  const [random, setRandom] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [peerConnection, setPeerConnection] = useState(null);
  const [dataChannel, setDataChannel] = useState(null);
  const check = (n) => {
    checkPeerConnection(peerConnection, n);
  };

  useEffect(() => {
    const fetchRandomString = async () => {
      try {
        const randomString = await getRandomString();
        setRandom(randomString);
      } catch (error) {
        // Handle error if necessary
      }
    };
    fetchRandomString();
  }, []);

  useEffect(() => {
    socket.on("file-found", (data) => {
      console.log("file found", data);
    });
    socket.on("receiver-found", (data) => {
      console.log("receiver found");
      check(0);
      createPeerConnection(data.id);
      check(1);
    });
    socket.on("ice-candidate", async (message) => {
      //   console.log("ice-candidate received", Object.keys(message));
      if (message.answer) {
        if (peerConnection) {
          // console.log("answer received");
          const remoteDesc = new RTCSessionDescription(message.answer);
          await peerConnection.setRemoteDescription(remoteDesc);
        } else {
          console.log("peer connection not set yet");
        }
      }
      if (message.offer) {
        // console.log("offer received");
        const configuration = {
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        };
        const pc = new RTCPeerConnection(configuration);
        pc.setRemoteDescription(new RTCSessionDescription(message.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        // console.log("sending answer", secretKey);
        socket.emit("ice-candidate", { id: message.id, answer: answer });
        setPeerConnection(pc);
      }
    });
  }, [socket]);

  const createPeerConnection = async (random) => {
    try {
      const configuration = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };
      const pc = new RTCPeerConnection(configuration);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log(pc);
      setPeerConnection((prevPeerConnection) => pc);

      // Emit offer after setting local description
      await socket.emit("ice-candidate", {
        offer: offer,
        id: random,
      });
      
      check(2);
    } catch (error) {
      console.error("Error creating peer connection:", error);
      // Handle error if necessary
    }
  };

  const onReceive = () => {
    setIsSending(false);
  };

  const findFile = () => {
    socket.emit("find-file", { id: secretKey });
  };

  const uploadFile = () => {
    socket.emit("send-file", { id: random, info: "my_message" });
  };

  const onSend = () => {
    setIsSending(true);
    setSecretKey("");
  };

  return (
    <div className="bg-black h-screen w-full text-white">
      <p className="text-6xl text-center">Home</p>
      <div className="h-40"></div>
      <div className="w-full justify-center flex gap-10 text-2xl text-black font-bold">
        <button
          className="w-40 h-14 bg-yellow-300 rounded-2xl"
          onClick={onSend}
        >
          Send
        </button>
        <button
          className="w-40 h-14 bg-yellow-300 rounded-2xl"
          onClick={onReceive}
        >
          Receive
        </button>
      </div>
      {isSending ? (
        <div className="flex-row">
          <p>Choose your file</p>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => setFile(e.target.files[0])}
          />
          <button
            className="border-2 rounded-lg"
            onClick={() => {
              fileInputRef.current.value = "";
              setFile(null);
            }}
          >
            Clear
          </button>
          <button
            className="border-2 rounded-lg"
            onClick={() => {
              uploadFile();
            }}
          >
            Upload
          </button>
          <div
            onClick={() => {
              navigator.clipboard.writeText(random);
            }}
          >
            <p>Share this with the receiver: {random}</p>
          </div>
        </div>
      ) : (
        <div>
          <p>Enter the secret code</p>
          <input
            className="text-black"
            value={secretKey}
            onChange={(e) => {
              setSecretKey(e.target.value);
            }}
            type="text"
          />
          <button
            onClick={() => {
              findFile();
            }}
          >
            Find your file
          </button>
        </div>
      )}
    </div>
  );
}
