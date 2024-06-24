import servers from "./servers.json";

const googleServers = [{
    urls : "stun:stun.l.google.com:19302"
}]

const peerConnection = new RTCPeerConnection({
    iceServers: googleServers,
    // turnServers: [
    //     {
    //         urls: "numb.viagenie.ca",
    //     }
    // ]
});
export default peerConnection;

