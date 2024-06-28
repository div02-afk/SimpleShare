import servers from "./servers.json";

const googleServers = [{
    urls : "stun:stun.l.google.com:19302"
}]

const peerConnectionInfo = {
    iceServers: servers,
    sdpSemantics: 'unified-plan'
    // turnServers: [
    //     {
    //         urls: "numb.viagenie.ca",
    //     }
    // ]
};
export default peerConnectionInfo;

