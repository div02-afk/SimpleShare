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
  peerConnections = [];
  fileParts = [];
  receivedChunks = [];
  receiving = false;
  sizeReceived = 0;
  temp = false;
  noOfPeerConnections = 0;
  constructor(uniqueId) {
    super();
    this.noOfPeerConnections = 5;
    this.peerConnections = this.createPeerConnections(this.noOfPeerConnections);
    console.log(this.peerConnections);
    this.uniqueId = uniqueId;
    this.socket = io(serverAddress);
    // this.dataChannel2 = this.peerConnection.createDataChannel("myDataChannel2");
    // this.dataChannelHandler();

    // this.peerConnection.onsignalingstatechange = () => {
    //   // console.log(
    //   //   "Signaling state changed to:",
    //   //   this.peerConnection.signalingState
    //   // );
    // };
    // this.peerConnection.onicecandidate = (event) => {
    //   // console.log("ice candidate event, sending", event);
    //   this.handleIceCandidate(event, "receiver");
    // };
    this.initiateSocketListeners();
    this.initiatePeerConnectionListners();
    //   this.peerConnection.oniceconnectionstatechange = () => {
    //     console.log(
    //       "ICE connection state:",
    //       this.peerConnection.iceConnectionState
    //     );
    //     if (
    //       this.peerConnection.iceConnectionState === "connected" ||
    //       this.peerConnection.iceConnectionState === "completed"
    //     ) {
    //       store.dispatch({ type: "CONNECT" });
    //       console.log("Peer connection is established");
    //     }
    //   };
  }

  initiatePeerConnectionListners() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.dataChannelHandler(i);
      this.peerConnections[i].onicecandidate = (event) => {
        this.handleIceCandidate(event, "receiver", i);
      };
      this.peerConnections[i].oniceconnectionstatechange = () => {
        console.log(
          `ICE connection state for ${i}:`,
          this.peerConnections[i].iceConnectionState
        );
        if (
          this.peerConnections[i].iceConnectionState === "connected" ||
          this.peerConnections[i].iceConnectionState === "completed"
        ) {
          store.dispatch({ type: "CONNECT" });
          console.log(`Peer connection ${i} is established`);
        }
      };
      
    }
  }

  initiateSocketListeners() {
    this.socket.emit("join-room", this.uniqueId);
    this.socket.on("offer", (data) => {
      this.handleOffer(data);
    });
    this.socket.on("ice-candidate", (data) => {
      // console.log("ice candidate received", candidate);
      const candidate = data.candidate;
      const connectionId = data.connectionId;
      this.peerConnections[connectionId].addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });
    this.socket.on("metadata", (metadata) => {
      // console.log("metadata received", metadata);
      this.metadata = metadata;
      // console.log("metadata received", metadata.size / (1024 * 128));
      // this.receivedChunks = Array(MAth.max(Math.round(1+metadata.size / (1024 * 128))),1).fill(null);
    });
  }
  async handleOffer(data) {
    console.log(data)
    const connectionId = data.connectionId;
    const offer = data.offer;
    console.log("offer received for", connectionId);
    await this.peerConnections[connectionId].setRemoteDescription(
      new RTCSessionDescription(offer)
    );
    const answer = await this.peerConnections[connectionId].createAnswer();
    await this.peerConnections[connectionId].setLocalDescription(answer);
    // console.log("signalling state after answer generation", this.peerConnection.signalingState);
    this.sendToSocket("answer", {
      room: this.uniqueId,
      answer: answer,
      connectionId: connectionId,
    });
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

  dataChannelHandler(connectionId) {
    console.log(
      "data handling for :",
      connectionId,
      this.peerConnections[connectionId]
    );
    this.peerConnections[connectionId].ondatachannel = (event) => {
      this.dataChannel = event.channel;
      // console.log("Data channel received", this.dataChannel.label);
      this.dataChannel.onopen = () => console.log("Data channel is open for",connectionId);
      this.dataChannel.onclose = () => console.log("Data channel is closed");
      this.dataChannel.onmessage = (event) => {
        // console.log("Data channel received message");
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
            console.log("Received chunk", message.index);
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
