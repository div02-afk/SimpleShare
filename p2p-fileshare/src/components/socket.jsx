import io from "socket.io-client";
const socket = io.connect("http://localhost:3000");

console.log("socket", socket.connected);
export default socket;