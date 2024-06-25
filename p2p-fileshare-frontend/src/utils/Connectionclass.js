// import peerConnection from "./peerConnectionSetup";

export default class Connection{
    // peerConnection =peerConnection
    constructor(){
       
    }
    async handleIceCandidate(event,sender) {
      if (event.candidate) {
        // this.peerConnection.addIceCandidate(event.candidate);
        this.sendToSocket("ice-candidate", {
          room: this.uniqueId,
          candidate: event.candidate,
          "sender" : sender
        });
      }
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