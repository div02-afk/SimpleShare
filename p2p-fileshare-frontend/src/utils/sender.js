import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";
import splitFile from "./fileSplitter.js";
import store from "./store.js";
export default class Sender extends Connection {
  peerConnection = null;
  socket = null;
  offer = null;
  uniqueId = null;
  isUniqueIDSet = false;
  dataChannel = null;
  partReceived = false;
  constructor(peerConnection) {
    super();
    this.peerConnection = peerConnection;
    this.uniqueId = this.getRandomIDandJoinRoom();
    this.socket = io(serverAddress);
    this.dataChannel = this.peerConnection.createDataChannel("myDataChannel");

    this.dataChannel.onopen = () => {
      console.log("Data channel is open");
    };
    this.peerConnection.ondatachannel = (event) => {
      console.log("Data channel received");
      this.dataChannel = event.channel;
    };
    this.dataChannel.onclose = () => console.log("Data channel is closed");
    this.dataChannel.onmessage = (event) => {
      console.log("Received message:", event.data);
      if (event.data == "received") {
        this.partReceived = true;
      }
    };

    // this.peerConnection.onsignalingstatechange = () => {
    //     console.log('Signaling state changed to:', this.peerConnection.signalingState);
    // };
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
    this.peerConnection.onicecandidate = (event) => {
      console.log("ice candidate event, sending", event);
      this.handleIceCandidate(event, "sender");
    };

    this.initiateSocketListeners();
  }

  initiateSocketListeners() {
    this.socket.on("answer", (answer) => {
      // console.log("answer received", answer);
      this.handleAnswer(answer.answer);
    });
    this.socket.on("room-full", () => {
      this.handleRoomFull();
    });
    this.socket.on("ice-candidate", (candidate) => {
      console.log("ice candidate received", candidate);

      this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });
  }

  async handleRoomFull() {
    this.offer = await this.createOffer();
  }

  async handleAnswer(answer) {
    // console.log("answer received");
    // console.log("peer connection state", this.peerConnection.signalingState);

    if (
      this.peerConnection.signalingState === "have-local-offer" ||
      this.peerConnection.signalingState === "have-remote-offer"
    ) {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      console.log(this.peerConnection.iceConnectionState);
    } else {
      console.error(
        "Peer connection not in correct state to set remote description:",
        this.peerConnection.signalingState
      );
    }
  }
  async createOffer() {
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveData: true,
    });
    await this.peerConnection.setLocalDescription(offer);
    // console.log("signalling state after offer generation", this.peerConnection.signalingState);
    await this.sendToSocket("offer", { room: this.uniqueId, offer: offer });
    return offer;
  }

  async getRandomIDandJoinRoom() {
    const response = await fetch(serverAddress + "/random");
    this.uniqueId = await response.text();
    console.log("unique id", this.uniqueId);
    this.sendToSocket("join-room", this.uniqueId);
    this.isUniqueIDSet = true;
  }

  // async sendFile(file) {
  //   const fileParts = await splitFile(file);
  //   for (let i = 0; i < fileParts.length; i++) {
  //     this.partReceived = false;
  //     const dataToSend = JSON.stringify({
  //       data: fileParts[i],
  //     });
  //     if (i == fileParts.length / 2) {
  //       console.log("50% completed");
  //     }
  //     this.dataChannel.send(dataToSend);
  //     setInterval(() => {
  //       if (this.partReceived) {
  //         clearInterval();
  //       }
  //     }, 100);
  //   }
  //   console.log("File sent");
  //   this.dataChannel.send(JSON.stringify({ data: "<this_is_the_end>" }));
  // }

  sendFile(blob) {
    const CHUNK_SIZE = 16384; // 16KB
    let offset = 0;

    const sendNextChunk = () => {
      const slice = blob.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (event) => {
        if (event.target.readyState === FileReader.DONE) {

          this.dataChannel.send(event.target.result);

          offset += CHUNK_SIZE;
          if (offset < blob.size) {
            const intervalId = setInterval(() => {
              if (this.partReceived) {
                console.log("Part received");
                this.partReceived = false;
                clearInterval(intervalId);
              }
            }, 100);
            intervalId;
            sendNextChunk();
          } else {
            // Optionally send a signal that the blob has been fully sent
            this.dataChannel.send(JSON.stringify({ type: "done" }));
          }
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNextChunk();
  }
}
