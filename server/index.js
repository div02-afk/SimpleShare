const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { type } = require("os");
const express = require("express");
const app = express();
const crypto = require("crypto");
const { connected } = require("process");
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const room = {};
const userInfo = {};
app.get("/random", (req, res) => {
  res.send({ response: crypto.randomBytes(6).toString("hex") });
});

io.on("connection", (socket) => {
  socket.on("code", (data) => {
    socket.join(data.code);
    room[data.code] = [socket.id];
    console.log("user code set", data.code);
  });
  socket.on("startConnection", (data) => {
    if (room[data.code] && room[data.code].length == 1) {
      socket.join(data.code);
      room[data.code].push(socket.id);
      socket.to(data.code).emit("beginSDP",data);
    } else {
      socket.emit("invalidCode");
    }
  });
  socket.on("offer", (data) => {
    console.log("offer received from", data.code);
    socket.to(data.code).emit("offer", data);
  });
  socket.on("answer", (data) => {
    console.log("answer received from", data.code);
    socket.to(data.code).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.code).emit("ice-candidate", data);
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
