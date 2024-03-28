import { useEffect, useState } from "react";
import socket from "./socket";
import { handleIceCandidateFromPeer, peerConnection } from "./peerConnection";
export default function Receive() {
  //   const configuration = {
  //     iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  //   };
  const [randomCode, setrandomCode] = useState("");
  //   const [peerConnection, setPeerConnection] = useState(
  //     new RTCPeerConnection(configuration)
  //   );
  useEffect(() => {
    socket.on("offer", (data) => {
      console.log("offer received");
      //   console.log(peerConnection);
      handleOffer(data);
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
//         console.log("Sending ice candidate from receiver");
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

  const handleOffer = async (data) => {
    // const configuration = {
    //   iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    // };
    // const pc = new RTCPeerConnection(configuration);
    const remoteOffer = new RTCSessionDescription(data.offer);
    try {
      peerConnection.setRemoteDescription(remoteOffer);
    } catch (e) {
      console.log(e);
    }
    console.log(peerConnection);
    const answer = await peerConnection.createAnswer();
    try {
      await peerConnection.setLocalDescription(answer);
    } catch (e) {
      console.log(e);
    }
    // setPeerConnection(pc);
    console.log("answer ", answer);
    socket.emit("answer", { code: data.code, answer: answer });
  };
  const beginDownload = async () => {
    socket.emit("startConnection", { code: randomCode });
  };

  return (
    <div className="w-screen justify-center flex-row flex text-center mt-20 gap-20">
      <div>
        <input
          value={randomCode}
          onChange={(e) => setrandomCode(e.target.value)}
          type="text"
          className="rounded-lg h-7 pl-1 placeholder-black text-black"
          placeholder="Enter secret code"
        />
      </div>
      <button
        onClick={() => {
          beginDownload();
        }}
        className="border-2 rounded-lg w-44 text-xl"
      >
        Begin Download
      </button>
    </div>
  );
}
