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
  }