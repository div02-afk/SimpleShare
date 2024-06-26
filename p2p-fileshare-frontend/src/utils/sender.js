import { io } from "socket.io-client";
import Connection from "./Connectionclass.js";
import serverAddress from "./serverLink.js";
import splitFile from "./fileSplitter.js";
import store from "./store.js";
export default class Sender extends Connection {
  peerConnection = null;
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
    this.noOfPeerConnections = 5;
    this.peerConnections = this.createPeerConnections(this.noOfPeerConnections);
    this.uniqueId = this.getRandomIDandJoinRoom();
    this.socket = io(serverAddress);

    for (let i = 0; i < this.noOfPeerConnections; i++) {
      this.dataChannels[i] = [];
      this.createDataChannels(10, i);
    }
    // this.dataChannel = this.peerConnection.createDataChannel("myDataChannel");
    // // console.log(this.dataChannels);
    // this.dataChannel.onopen = () => {
    //   console.log("Data channel is open");
    // };
    // this.peerConnection.ondatachannel = (event) => {
    //   console.log("Data channel received");
    //   this.dataChannel2 = event.channel;
    //   this.dataChannel2.onopen = () => {
    //     console.log("Data channel 2 is open");
    //   };
    //   this.dataChannel2.onmessage = (event) => {
    //     console.log("Data channel 2 message received", event.data);
    //     if (event.data == "received") {
    //       this.partReceived = true;
    //     }
    //   };
    // };
    // this.dataChannel.onclose = () => console.log("Data channel is closed");
    // this.dataChannel.onmessage = (event) => {
    //   // console.log("Received message:", event.data);
    //   if (event.data == "received") {
    //     this.partReceived = true;
    //   }
    // };

    // this.peerConnection.onsignalingstatechange = () => {
    //     console.log('Signaling state changed to:', this.peerConnection.signalingState);
    // };

    // this.peerConnection.onicecandidate = (event) => {
    //   // console.log("ice candidate event, sending", event);
    //   this.handleIceCandidate(event, "sender");
    // };
    this.initiatePeerConnectionListners();
    this.initiateSocketListeners();
  }
  initiatePeerConnectionListners() {
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.peerConnections[i].onicecandidate = (event) => {
        this.handleIceCandidate(event, "sender", i);
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
  createDataChannels(noOfDataChannels, connectionId) {
    for (let i = 0; i < noOfDataChannels; i++) {
      const dataChannel = this.peerConnections[connectionId].createDataChannel(
        "MultiDataChannel_" + connectionId + "_" + i
      );

      this.dataChannels[connectionId].push(dataChannel);
      dataChannel.onopen = () => {
        console.log("Data channel is open");
      };
      dataChannel.onclose = () => console.log("Data channel is closed");
      // console.log("Data channel created", dataChannel.label);
    }
    // console.log("data channnels created for",connectionId,"with length",this.dataChannels[connectionId].length)
    console.log(this.dataChannels[connectionId][0]);
  }

  initiateSocketListeners() {
    this.socket.on("answer", (data) => {
      console.log("answer received for", data.connectionId);
      this.handleAnswer(data);
    });
    this.socket.on("room-full", () => {
      this.handleRoomFull();
    });
    this.socket.on("ice-candidate", (data) => {
      console.log("ice candidate received for", data.connectionId);
      const candidate = data.candidate;
      const connectionId = data.connectionId;
      this.peerConnections[connectionId].addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    });
  }

  async handleRoomFull() {
    // this.offer = await this.createOffer();
    for (let i = 0; i < this.peerConnections.length; i++) {
      this.offers.push(await this.createOffer(i));
    }
  }

  async handleAnswer(data) {
    // console.log("answer received");
    // console.log("peer connection state", this.peerConnection.signalingState);
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
      console.log(this.peerConnections[connectionId].iceConnectionState);
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
    // console.log("signalling state after offer generation", this.peerConnection.signalingState);
    await this.sendToSocket("offer", {
      room: this.uniqueId,
      offer: offer,
      connectionId: connectionId,
    });
    console.log("offer sent for", connectionId);
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
    console.log("Sending file of size", blob.size / 1024, "KB");
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
          if(finalDataToSend.length > 2000){
            this.dataBalancer(finalDataToSend);
            // clearInterval(memoryOverheadSolution);
            finalDataToSend = []
          }
          console.log("current length", finalDataToSend.length);
          // this.dataChannels[dataChannelNumber].send(dataToSend);
          // console.log("Sent part", index, "to data channel", dataChannelNumber);
          index++;
          count--;
          offset += CHUNK_SIZE;
          if (offset < blob.size) {
            // if (count == 0) {
            //   const intervalId = setInterval(() => {
            //     if (this.partReceived) {
            //       // console.log("Part received");
            //       this.partReceived = false;
            //       count = 10;
            //       sendNextChunk();
            //       clearInterval(intervalId);
            //     }
            //   }, 10);
            //   intervalId;
            // } else {
            sendNextChunk();
            // }
          } else {
            // Optionally send a signal that the blob has been fully sent
            // console.log("File sent");

            finalDataToSend.push(
              JSON.stringify({ type: "the file sharing is completed" })
            );
            console.log("final length", finalDataToSend);
            console.log(finalDataToSend[finalDataToSend.length[-1]]);
            this.dataBalancer(finalDataToSend);
          }
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNextChunk();

    // this.dataChannel.send(JSON.stringify({ type: "done" }));
  }

  dataBalancer(finalDataToSend) {
    console.log("final length :", finalDataToSend.length);
    let start = 0;
    console.log(finalDataToSend.length);
    let step = Math.max(
      Math.floor(finalDataToSend.length / this.noOfPeerConnections),
      1
    );

    console.log("step: ", step);
    let end = step;
    for (let i = 0; i < this.noOfPeerConnections; i++) {
      console.log(`from : ${start} to ${end}`);
      this.sendDataToDataChannels(finalDataToSend, start, end, i);
      if (end == finalDataToSend.length - 1) {
        break;
      }
      start = end;
      end = Math.min(end + step, finalDataToSend.length - 1);
    }
    end = finalDataToSend.length;
    console.log(`from : ${start} to ${end}`);
    this.sendDataToDataChannels(finalDataToSend, start, end, 0);
    console.log();
    console.log("file sent");
  }

  async sendDataToDataChannels(data, start, end, connectionId) {
    let dataChannelNumber = 0;

    // console.log("data channel length",this.dataChannels[connectionId])
    for (let i = start; i < end; i++) {
      dataChannelNumber = (dataChannelNumber + 1) % 10;
      if (
        this.dataChannels[connectionId][dataChannelNumber].readyState != "open"
      ) {
        const whenReady = setInterval(() => {
          if (
            this.dataChannels[connectionId][dataChannelNumber].readyState ==
            "open"
          ) {
            this.dataChannels[connectionId][dataChannelNumber].send(data[i]);
            clearInterval(whenReady);
          }
        }, 50);
        whenReady;
        continue;
      }
      // console.log(`sending ${data[i].type} of ${data[i].index} via ${connectionId} `)
      else {
        this.dataChannels[connectionId][dataChannelNumber].send(data[i]);
      }
      // console.log("sending via ", this.dataChannels[connectionId][dataChannelNumber])
    }
  }
}
