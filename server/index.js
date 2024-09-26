const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const cors = require("cors");
const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  let userCount = io.engine.clientsCount;
  console.log("a user connected", userCount);
  socket.on("join-room", (room) => {
    console.log("user joined room", room);
    socket.join(room);
    const roomSize = io.sockets.adapter.rooms.get(room)?.size || 1;
    console.log("Number of users in room:", roomSize);
    if (roomSize >= 2) {
      socket.to(room).emit("room-full");
    }
  });
  socket.on("offer", (data) => {
    socket.to(data.room).emit("offer", data);
  });

  socket.on("answer", (data) => {
    socket.to(data.room).emit("answer", data);
  });

  socket.on("ice-candidate", (data) => {
    // console.log('ice-candidate received',data.candidate);
    socket.to(data.room).emit("ice-candidate", data);
  });
  socket.on("metadata", (data) => {
    socket.to(data.room).emit("metadata", data);
  });
  socket.on("received", (data) => {
    socket.to(data.room).emit("received", data.data);
  });
  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

app.get("/random", (req, res) => {
  const randomID = crypto.randomBytes(2).toString("hex");
  res.send(randomID);
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
