import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";
import store from "./store.js";

export default class Receiver extends Connection {
  peerConnection = null;
  socket = null;
  uniqueId = null;
  dataChannel = null;
  dataChannel2 = null;
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
    this.dataChannel2 = this.peerConnection.createDataChannel("myDataChannel2");
    this.dataChannelHandler();

    this.peerConnection.onsignalingstatechange = () => {
      // console.log(
      //   "Signaling state changed to:",
      //   this.peerConnection.signalingState
      // );
    };
    this.peerConnection.onicecandidate = (event) => {
      // console.log("ice candidate event, sending", event);
      this.handleIceCandidate(event, "receiver");
    };
    this.initiateSocketListeners();

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
      // console.log("ice candidate received", candidate);

      this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });
    this.socket.on("metadata", (metadata) => {
      // console.log("metadata received", metadata);
      this.metadata = metadata;
      // console.log("metadata received", metadata.size / (1024 * 128));
      // this.receivedChunks = Array(MAth.max(Math.round(1+metadata.size / (1024 * 128))),1).fill(null);
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
  // receiveFile(data) {
  //   if (data === "<this_is_the_end>") {
  //     console.log(
  //       `File received. Downloading...${
  //         this.fileParts.length
  //       } MB, with type ${typeof this.fileParts[0]}`
  //     );

  //     const receivedData = new Blob(this.fileParts);

  //     const link = document.createElement("a");
  //     const blobURL = URL.createObjectURL(receivedData);
  //     link.href = blobURL;
  //     link.download = this.metadata.name;
  //     document.body.appendChild(link);
  //     link.click();
  //     document.body.removeChild(link);
  //     URL.revokeObjectURL(blobURL);
  //   } else {
  //     console.log("Received data", data.length, typeof data);
  //     this.fileParts.push(data);
  //     this.dataChannel.send("received");
  //   }
  // }

  dataChannelHandler() {
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      // console.log("Data channel received", this.dataChannel.label);
      this.dataChannel.onopen = () => console.log("Data channel is open");
      this.dataChannel.onclose = () => console.log("Data channel is closed");
      this.dataChannel.onmessage = (event) => {
        // console.log("Data channel received message",typeof event.data);
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          // console.log("Message received in valid format",message.index,message.type);
          if (message.type === "the file sharing is completed") {
            // All chunks received, assemble them into a single Blob
            console.log("All chunks received", this.receivedChunks.length);
            const receivedBlob = new Blob(this.receivedChunks);
            console.log("Blob received:", receivedBlob);

            // Reset for the next blob
            this.receivedChunks = [];
            this.receiving = false;

            // Create a URL for the Blob and use it in an HTML element
            const url = URL.createObjectURL(receivedBlob);
            const link = document.createElement("a");
            link.href = url;
            link.download = this.metadata.name || "temp.temp"; // Change the filename if needed
            link.click();
            URL.revokeObjectURL(url);
            // document.body.removeChild(link);
          } else if (message.type === "data") {
            // console.log("Received chunk", message.index);
            message.data = this.base64ToArrayBuffer(message.data);
            // Add the received chunk to the array
            // console.log("Received chunk", message.index);
            const { index, totalChunks, data: arrayBuffer } = message;

            // console.log("Received chunk", index, arrayBuffer.byteLength);
            this.receivedChunks[index] = arrayBuffer;
            this.sizeReceived++;
            // console.log("Size received", this.sizeReceived);
            if (this.sizeReceived % 9 == 0) {
              // console.log("sending response", this.sizeReceived);
            this.dataChannel2.send("received");
              // console.log("response sent");
            }
            if (this.receivedChunks.length == 1) {
              store.dispatch({ type: "RECEIVE" });
            }
            store.dispatch({
              type: "SIZE_RECEIVED",
              payload:
                store.getState().key.sizeReceived +
                arrayBuffer.byteLength / 1024,
            });
            this.receiving = true;
          }
        } else {
          console.log("Data channel received message", event.data);
        }
      };
    };
  }
}
