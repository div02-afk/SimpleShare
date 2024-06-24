import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
export default class Receiver extends Connection {
  peerConnection = null;
  socket = null;
  uniqueId = null;
  dataChannel = null;
  metadata = null;
  constructor(peerConnection, uniqueId) {
    super();
    this.peerConnection = peerConnection;
    this.uniqueId = uniqueId;
    this.socket = io("https://p2p-fileshare.onrender.com");
    this.dataChannel = this.peerConnection.createDataChannel("myDataChannel");
    this.peerConnection.onsignalingstatechange = () => {
      console.log(
        "Signaling state changed to:",
        this.peerConnection.signalingState
      );
    };
    this.peerConnection.onicecandidate = (event) => {
      console.log("ice candidate event, sending", event);
      this.handleIceCandidate(event, "receiver");
    };
    this.initiateSocketListeners();
    this.dataChannel.onopen = () => console.log("Data channel is open");
    this.dataChannel.onclose = () => console.log("Data channel is closed");
    this.dataChannel.onmessage = (event) => {
      console.log("Received message:", event.data);
      this.receiveFile(event.data);
    };
    this.peerConnection.oniceconnectionstatechange = () => {
      console.log(
        "ICE connection state:",
        this.peerConnection.iceConnectionState
      );
      if (
        this.peerConnection.iceConnectionState === "connected" ||
        this.peerConnection.iceConnectionState === "completed"
      ) {
        console.log("Peer connection is established");
      }
    };
  }
  initiateSocketListeners() {
    this.socket.emit("join-room", this.uniqueId);
    this.socket.on("offer", (offer) => {
      this.handleOffer(offer);
    });
    this.socket.on("ice-candidate", (candidate) => {
      console.log("ice candidate received", candidate);

      this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });
    this.socket.on("metadata", (metadata) => {
      console.log("metadata received", metadata);
      this.metadata = metadata;
    });
  }
  async handleOffer(offer) {
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer)
    );
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    // console.log("signalling state after answer generation", this.peerConnection.signalingState);
    this.sendToSocket("answer", { room: this.uniqueId, answer: answer });
  }

  async sendToSocket(type, msg) {
    this.socket.emit(type, msg);
  }
  receiveFile(data) {
    const receivedData = new Blob([data]);
    const link = document.createElement("a");
    const blobURL = URL.createObjectURL(receivedData);
    link.href = blobURL;
    link.download = this.metadata.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobURL);
  }
}
