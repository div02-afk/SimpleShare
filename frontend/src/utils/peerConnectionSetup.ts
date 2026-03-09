import servers from "./servers.json";

const peerConnectionInfo: RTCConfiguration & { sdpSemantics?: string } = {
  iceServers: servers as RTCIceServer[],
  sdpSemantics: "unified-plan",
};

export default peerConnectionInfo;
