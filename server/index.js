const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { type } = require("os");
const express = require("express");
const app = express();
const crypto = require("crypto");
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const userInfo = {};
app.get("/random", (req, res) => {
  res.send({ response: crypto.randomBytes(6).toString("hex") });
});
io.on("connection", (socket) => {
  console.log("a user connected", socket.id);
  socket.on("send-file", (data) => {
    socket.join(data.id);
    userInfo[data.id] = data.info;
    console.log("file received", data);
  });
  socket.on("ice-candidate", (data) => {
    console.log("ice candidate", Object.keys(data));
    socket.to(data.id).emit("ice-candidate", data);
  });
  socket.on("find-file", (data) => {
    if (userInfo[data.id]) {
      socket.join(data.id);
      console.log("file found", userInfo[data.id] ,"at", data.id);
      socket.emit("file-found", { info: userInfo[data.id] });
      socket.to(data.id).emit("receiver-found",{id : data.id});
    } else {
      console.log("file not found");
    }
  });
  socket.on("disconnect", () => {
    socket.leaveAll();
    console.log("user disconnected");
  });
});
server.listen(3000, () => {
  console.log("listening on *:3000");
});
