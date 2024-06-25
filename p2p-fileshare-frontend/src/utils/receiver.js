import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";
import store from "./store.js";
export default class Receiver extends Connection {
  peerConnection = null;
  socket = null;
  uniqueId = null;
  dataChannel = null;
  metadata = null;
  fileParts = [];
  receivedChunks = [];
  receiving = false;
  sizeReceived = 0;
  temp = false;
  constructor(peerConnection, uniqueId) {
    super();
    this.peerConnection = peerConnection;
    this.uniqueId = uniqueId;
    this.socket = io(serverAddress);
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
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data);
        if (message.type === "done") {
          // All chunks received, assemble them into a single Blob
          const receivedBlob = new Blob(this.receivedChunks);
          console.log("Blob received:", receivedBlob);

          // Reset for the next blob
          this.receivedChunks = [];
          this.receiving = false;

          // Create a URL for the Blob and use it in an HTML element
          const url = URL.createObjectURL(receivedBlob);
          const link = document.createElement("a");
          link.href = url;
          link.download = this.metadata.name; // Change the filename if needed
          link.click();
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Add the received chunk to the array
        this.receivedChunks.push(event.data);
        this.sizeReceived++;
        console.log("sending response")
        this.dataChannel.send("received");
        console.log("response sent")
        if (this.receivedChunks.length == 1) {
          store.dispatch({ type: "RECEIVE" });
        }
        store.dispatch({ type: "SIZE_RECEIVED", payload: this.sizeReceived * 16 });
        this.receiving = true;
      }
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
        store.dispatch({ type: "CONNECT" });
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
    if (data === "<this_is_the_end>") {
      console.log(
        `File received. Downloading...${
          this.fileParts.length
        } MB, with type ${typeof this.fileParts[0]}`
      );

      const receivedData = new Blob(this.fileParts);

      const link = document.createElement("a");
      const blobURL = URL.createObjectURL(receivedData);
      link.href = blobURL;
      link.download = this.metadata.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobURL);
    } else {
      console.log("Received data", data.length, typeof data);
      this.fileParts.push(data);
      this.dataChannel.send("received");
    }
  }
}
