import { useEffect, useState } from "react";
import socket from "./socket";
import { handleIceCandidateFromPeer, peerConnection } from "./peerConnection";

export default function Send({ allowSending }) {
  const [randomCode, setRandomCode] = useState(null);
  const [file, setFile] = useState(null);
  //   const [peerConnection, setPeerConnection] = useState(
  //     new RTCPeerConnection(configuration)
  //   );
  const randomCodeTemp = randomCode;
  //   console.log("randomCodeTemp", randomCode);
  useEffect(() => {
    const getRandomCode = async () => {
      const randomCode = await fetch("http://localhost:3000/random");
      const data = await randomCode.json();
      socket.emit("code", { code: data.response });
      setRandomCode(data.response);
    };
    getRandomCode();
  }, []);
  useEffect(() => {
    socket.on("beginSDP", (data) => {
      console.log("beginSDP at", randomCode);
      beginSDP(data);
    });
    socket.on("answer", (data) => {
      console.log("answer received");
      handleAnswer(data.answer);
    });
    socket.on("ice-candidate", (data) => {
      console.log("ice-candidate received");
      handleIceCandidateFromPeer(peerConnection, data.candidate);
    });
  }, [socket]);

//   useEffect(() => {
//     if (!peerConnection) return;
//     const handleIceCandidate = (event) => {
//       if (event.candidate) {
//         console.log("Sending ice candidate from sender");
//         socket.emit("ice-candidate", {
//           code: randomCode,
//           candidate: event.candidate,
//         });
//       }
//     };
//     peerConnection.addEventListener("icecandidate", handleIceCandidate);
//     return () => {
//       peerConnection.removeEventListener("icecandidate", handleIceCandidate);
//     };
//   }, [peerConnection, randomCode]);

  const handleAnswer = async (answer) => {
    const remoteDesc = new RTCSessionDescription(answer);
    await peerConnection.setRemoteDescription(remoteDesc);
  };
  const beginSDP = async (data) => {
    // const configuration = {
    //   iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    // };
    // const pc = new RTCPeerConnection(configuration);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    // setPeerConnection(pc);
    console.log("offer sent at", offer);
    socket.emit("offer", { code: data.code, offer: offer });
  };

  //   const handleIceCandidateFromPeer = async (candidate) => {
  //     try {
  //       await peerConnection.addIceCandidate(candidate);
  //     } catch (error) {
  //       console.error("Error adding ice candidate:", error);
  //     }
  //   };

  return (
    <div className="w-screen justify-center flex-col text-center mt-20">
      <p className="text-3xl mb-20">
        Secret code{" "}
        <span
          onClick={() => {
            navigator.clipboard.writeText(randomCode);
          }}
          className="bg-yellow-300 rounded-lg font-medium text-black p-2 select-none cursor-pointer"
        >
          {randomCode}
        </span>
      </p>
      <input type="file" />
      <button
        className="border-2 rounded-lg w-40 text-xl"
        disabled={allowSending}
      >
        Begin Transfer
      </button>
    </div>
  );
}
