import socket from "./socket";

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const peerConnection = new RTCPeerConnection(configuration);

const handleIceCandidateFromPeer = async (peerConnection, candidate) => {
  try {
    await peerConnection.addIceCandidate(candidate);
    console.log("Ice candidate added");
  } catch (error) {
    console.error("Error adding ice candidate:", error);
  }
};
peerConnection.addEventListener("icecandidate", (event) => {
  if (event.candidate) {
    console.log("Sending ice candidate from sender");
    socket.emit("ice-candidate", {
      code: randomCode,
      candidate: event.candidate,
    });
  }
});

export { peerConnection, handleIceCandidateFromPeer };
