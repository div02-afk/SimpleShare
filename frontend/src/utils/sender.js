import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";
import splitFile from "./fileSplitter.js";
import store from "../store.js";
export default class Sender extends Connection {
  peerConnection = null;
  temp = 0;
  socket = null;
  offers = [];
  uniqueId = null;
  isUniqueIDSet = false;
  dataChannel = null;
  dataChannels = [];
  peerConnections = [];
  dataChannel2 = null;
  partReceived = false;
  noOfPeerConnections = 0;
  constructor() {
    super();
    this.noOfPeerConnections = 10;
    this.peerConnections = this.createPeerConnections(this.noOfPeerConnections);
    this.uniqueId = this.getRandomIDandJoinRoom();
    this.socket = io(serverAddress);

    for (let i = 0; i < this.noOfPeerConnections; i++) {
      this.dataChannels[i] = [];
      this.createDataChannels(10, i);
    }
    this.initiatePeerConnectionListners();
    this.initiateSocketListeners();
  }
  initiatePeerConnectionListners() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.peerConnections[i].onicecandidate = (event) => {
        this.handleIceCandidate(event, "sender", i);
      };
      this.peerConnections[i].oniceconnectionstatechange = () => {
        // console.log(
        //   `ICE connection state for ${i}:`,
        //   this.peerConnections[i].iceConnectionState
        // );
        if (
          this.peerConnections[i].iceConnectionState === "connected" ||
          this.peerConnections[i].iceConnectionState === "completed"
        ) {
          store.dispatch({ type: "CONNECT" });
          // console.log(`Peer connection ${i} is established`);
          this.temp++;
          if (this.temp == this.noOfPeerConnections) {
            store.dispatch({ type: "ALL_CONNECTED" });
          }
        }
      };
    }
  }
  createDataChannels(noOfDataChannels, connectionId) {
    for (let i = 0; i < noOfDataChannels; i++) {
      const dataChannel = this.peerConnections[connectionId].createDataChannel(
        "MultiDataChannel_" + connectionId + "_" + i
      );

      this.dataChannels[connectionId].push(dataChannel);
      dataChannel.onopen = () => {
        // console.log("Data channel is open");
      };
      dataChannel.onclose = () => {
        
        // console.log("Data channel is closed")
      };
    }
    // console.log(this.dataChannels[connectionId][0]);
  }

  initiateSocketListeners() {
    this.socket.on("answer", (data) => {
      // console.log("answer received for", data.connectionId);
      this.handleAnswer(data);
    });
    this.socket.on("received", (data) => {
      store.dispatch({ type: "SIZE_RECEIVED", payload: data });
    });
    this.socket.on("room-full", () => {
      this.handleRoomFull();
    });
    this.socket.on("ice-candidate", (data) => {
      // console.log("ice candidate received for", data.connectionId);
      const candidate = data.candidate;
      const connectionId = data.connectionId;
      this.peerConnections[connectionId].addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });
  }

  async handleRoomFull() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.offers.push(await this.createOffer(i));
    }
  }

  async handleAnswer(data) {
    const connectionId = data.connectionId;
    const answer = data.answer;
    if (
      this.peerConnections[connectionId].signalingState ===
        "have-local-offer" ||
      this.peerConnections[connectionId].signalingState === "have-remote-offer"
    ) {
      await this.peerConnections[connectionId].setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      // console.log(this.peerConnections[connectionId].iceConnectionState);
    } else {
      console.error(
        "Peer connection not in correct state to set remote description:",
        this.peerConnections[connectionId].signalingState
      );
    }
  }
  async createOffer(connectionId) {
    const offer = await this.peerConnections[connectionId].createOffer({
      offerToReceiveAudio: true,
      offerToReceiveData: true,
    });
    await this.peerConnections[connectionId].setLocalDescription(offer);
    await this.sendToSocket("offer", {
      room: this.uniqueId,
      offer: offer,
      connectionId: connectionId,
    });
    // console.log("offer sent for", connectionId);
    return offer;
  }

  async getRandomIDandJoinRoom() {
    try {
      const response = await fetch(serverAddress + "/random");
      // console.log("response", response);
      this.uniqueId = await response.text();
      this.sendToSocket("join-room", this.uniqueId);
      this.isUniqueIDSet = true;
    } catch {
      console.log("Server not responding");
      setTimeout(() => {
        this.getRandomIDandJoinRoom();
      }, 1000);
    }
  }

  sendFile(file) {
    const blob = new Blob([file]);
    const CHUNK_SIZE = 1024 * 128; // 128KB
    let offset = 0;
    let count = 20;
    let index = 0;
    let dataChannelNumber = 0;
    const metadata = {
      room: this.uniqueId,
      type: file.type,
      size: file.size,
      name: file.name,
    };
    let finalDataToSend = [];

    this.sendToSocket("metadata", metadata);
    // console.log("Sending file of size", blob.size / 1024, "KB");
    const sendNextChunk = () => {
      const slice = blob.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (event) => {
        if (event.target.readyState === FileReader.DONE) {
          dataChannelNumber =
            (dataChannelNumber + 1) % this.dataChannels.length;

          const arrayBuffer = this.arrayBufferToBase64(event.target.result);
          const dataToSend = JSON.stringify({
            type: "data",
            data: arrayBuffer,
            dataChannelNumber: dataChannelNumber,
            index: index,
          });
          finalDataToSend.push(dataToSend);
          if (finalDataToSend.length > 500) {
            this.dataBalancer(finalDataToSend);
            finalDataToSend = [];
          }
          index++;
          count--;
          offset += CHUNK_SIZE;
          if (offset < blob.size) {
            sendNextChunk();
          } else {
            finalDataToSend.push(
              JSON.stringify({
                type: "the file sharing is completed",
                index: index,
              })
            );
            // console.log(
            //   "final length",
            //   finalDataToSend[finalDataToSend.length - 1]
            // );
            this.dataBalancer(finalDataToSend);
          }
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNextChunk();
  }

  dataBalancer(finalDataToSend) {
    // console.log("final length :", finalDataToSend.length);
    let start = 0;
    // console.log(finalDataToSend.length);
    let step = Math.max(
      Math.floor(finalDataToSend.length / this.noOfPeerConnections),
      1
    );
    let end = step;
    for (let i = 0; i < this.noOfPeerConnections; i++) {
      this.sendDataToDataChannels(finalDataToSend, start, end, i);
      if (end == finalDataToSend.length - 1) {
        break;
      }
      start = end;
      end = Math.min(end + step, finalDataToSend.length - 1);
    }
    end = finalDataToSend.length;
    this.sendDataToDataChannels(finalDataToSend, start, end, 0);
  }

  async sendDataToDataChannels(data, start, end, connectionId) {
    let dataChannelNumber = 0;

    for (let i = start; i < end; i++) {
      dataChannelNumber = (dataChannelNumber + 1) % 10;
      if (
        this.dataChannels[connectionId][dataChannelNumber].bufferedAmount >
        14 * 1024 * 1024
      ) {
        const whenReady = setInterval(() => {
          if (
            this.dataChannels[connectionId][dataChannelNumber].bufferedAmount <
            10 * 1024 * 1024
          ) {
            this.dataChannels[connectionId][dataChannelNumber].send(data[i]);
            clearInterval(whenReady);
          }
        }, 50);
        whenReady;
      } else {
        this.dataChannels[connectionId][dataChannelNumber].send(data[i]);
      }
    }
  }
}
