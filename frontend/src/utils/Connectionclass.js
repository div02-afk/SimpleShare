import peerConnectionInfo from "./peerConnectionSetup";

const FRAME_TYPE_DATA = 1;
const FRAME_TYPE_COMPLETE = 2;
const DATA_FRAME_HEADER_BYTES = 9;
const COMPLETE_FRAME_BYTES = 5;

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

    createDataFrame(index, payloadBuffer) {
      const payloadBytes = new Uint8Array(payloadBuffer);
      const frame = new ArrayBuffer(DATA_FRAME_HEADER_BYTES + payloadBytes.byteLength);
      const view = new DataView(frame);

      view.setUint8(0, FRAME_TYPE_DATA);
      view.setUint32(1, index, true);
      view.setUint32(5, payloadBytes.byteLength, true);
      new Uint8Array(frame, DATA_FRAME_HEADER_BYTES).set(payloadBytes);

      return frame;
    }

    createCompleteFrame(totalChunks) {
      const frame = new ArrayBuffer(COMPLETE_FRAME_BYTES);
      const view = new DataView(frame);

      view.setUint8(0, FRAME_TYPE_COMPLETE);
      view.setUint32(1, totalChunks, true);

      return frame;
    }

    parseFrame(frame) {
      const arrayBuffer = this.normalizeBinaryFrame(frame);
      const view = new DataView(arrayBuffer);
      const type = view.getUint8(0);

      if (type === FRAME_TYPE_DATA) {
        const index = view.getUint32(1, true);
        const byteLength = view.getUint32(5, true);
        const payload = new Uint8Array(
          arrayBuffer,
          DATA_FRAME_HEADER_BYTES,
          byteLength
        );

        return {
          type: "data",
          index,
          byteLength,
          data: payload,
        };
      }

      if (type === FRAME_TYPE_COMPLETE) {
        return {
          type: "the file sharing is completed",
          totalChunks: view.getUint32(1, true),
        };
      }

      throw new Error(`Unknown frame type: ${type}`);
    }

    normalizeBinaryFrame(frame) {
      if (frame instanceof ArrayBuffer) {
        return frame;
      }

      if (ArrayBuffer.isView(frame)) {
        return frame.buffer.slice(
          frame.byteOffset,
          frame.byteOffset + frame.byteLength
        );
      }

      throw new Error("Unsupported frame type");
    }
  }
