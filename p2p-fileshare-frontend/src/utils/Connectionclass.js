import peerConnectionInfo from "./peerConnectionSetup";

export default class Connection{
    // peerConnection =peerConnection
    constructor(){
       
    }
    async handleIceCandidate(event,sender,i) {
      if (event.candidate) {
        // this.peerConnection.addIceCandidate(event.candidate);
        this.sendToSocket("ice-candidate", {
          room: this.uniqueId,
          candidate: event.candidate,
          "sender" : sender,
          "connectionId": i
        });
      }
    }
    createPeerConnections(numberOfPeerConnections){
      const peerConnections = []
      for (let i = 0; i < numberOfPeerConnections; i++) {
        // const singlePeerConnection = peerConnection;
        peerConnections.push(new RTCPeerConnection(peerConnectionInfo));
        
      }
      // console.log(peerConnections)
      return peerConnections;
    }
    async sendToSocket(type, msg) {
      this.socket.emit(type, msg);
    }
    getUniqueId() {
      return this.uniqueId;
    }
     arrayBufferToBase64(buffer) {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }
     base64ToArrayBuffer(base64) {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }
  }