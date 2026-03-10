const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const cors = require("cors");

function createRoomRegistry() {
  const rooms = new Map();
  const socketToParticipant = new Map();

  const getRoom = (roomId) => rooms.get(roomId) ?? null;

  const ensureRoom = (roomId) => {
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        participants: {
          sender: null,
          receiver: null,
        },
      };
      rooms.set(roomId, room);
    }

    return room;
  };

  const join = (roomId, role, socketId) => {
    const room = getRoom(roomId);

    if (role === "receiver" && (!room || !room.participants.sender)) {
      return { accepted: false, reason: "sender-not-found" };
    }

    if (room?.participants[role]) {
      return { accepted: false, reason: "duplicate-role" };
    }

    if (room && room.participants.sender && room.participants.receiver) {
      return { accepted: false, reason: "room-full" };
    }

    const nextRoom = ensureRoom(roomId);
    nextRoom.participants[role] = socketId;
    socketToParticipant.set(socketId, { roomId, role });

    return {
      accepted: true,
      roomReady:
        Boolean(nextRoom.participants.sender) &&
        Boolean(nextRoom.participants.receiver),
    };
  };

  const removeSocket = (socketId) => {
    const participant = socketToParticipant.get(socketId);
    if (!participant) {
      return null;
    }

    socketToParticipant.delete(socketId);
    const room = rooms.get(participant.roomId);

    if (!room) {
      return participant;
    }

    if (room.participants[participant.role] === socketId) {
      room.participants[participant.role] = null;
    }

    if (!room.participants.sender && !room.participants.receiver) {
      rooms.delete(participant.roomId);
    }

    return participant;
  };

  return {
    getRoom,
    join,
    removeSocket,
  };
}

function relayToPeer(socket, roomId, eventName, payload) {
  socket.to(roomId).emit(eventName, payload);
}

function registerSocketHandlers(io, socket, registry) {
  socket.on("join-room", (payload) => {
    const roomId = payload?.room;
    const role = payload?.role;

    if (!roomId || (role !== "sender" && role !== "receiver")) {
      socket.emit("join-rejected", {
        room: roomId ?? "",
        reason: "room-full",
      });
      return;
    }

    const result = registry.join(roomId, role, socket.id);
    if (!result.accepted) {
      socket.emit("join-rejected", {
        room: roomId,
        reason: result.reason,
      });
      return;
    }

    socket.join(roomId);

    if (result.roomReady) {
      io.to(roomId).emit("room-ready", { room: roomId });
    }
  });

  socket.on("offer", (data) => {
    relayToPeer(socket, data.room, "offer", data);
  });

  socket.on("answer", (data) => {
    relayToPeer(socket, data.room, "answer", data);
  });

  socket.on("ice-candidate", (data) => {
    relayToPeer(socket, data.room, "ice-candidate", data);
  });

  socket.on("metadata", (data) => {
    relayToPeer(socket, data.room, "metadata", data);
  });

  socket.on("receiver-ready", (data) => {
    relayToPeer(socket, data.room, "receiver-ready", data);
  });

  socket.on("receiver-error", (data) => {
    relayToPeer(socket, data.room, "receiver-error", data);
  });

  socket.on("receiver-finalizing", (data) => {
    relayToPeer(socket, data.room, "receiver-finalizing", data);
  });

  socket.on("transfer-complete", (data) => {
    relayToPeer(socket, data.room, "transfer-complete", data);
  });

  socket.on("received", (data) => {
    relayToPeer(socket, data.room, "received", data);
  });

  socket.on("ws-ping", (payload) => {
    socket.emit("ws-pong", {
      sentAt: payload?.sentAt ?? Date.now(),
      serverTime: Date.now(),
    });
  });

  socket.on("peer-transport-state", (payload) => {
    relayToPeer(socket, payload.room, "peer-transport-state", payload);
  });

  socket.on("disconnect", () => {
    const removedParticipant = registry.removeSocket(socket.id);
    if (!removedParticipant) {
      return;
    }

    socket.to(removedParticipant.roomId).emit("peer-left", {
      room: removedParticipant.roomId,
      role: removedParticipant.role,
    });
  });
}

function createHttpApp() {
  const app = express();
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST"],
    })
  );
  app.get("/random", (req, res) => {
    const randomID = crypto.randomBytes(2).toString("hex");
    res.send(randomID);
  });

  return app;
}

function createSignalingServer() {
  const app = createHttpApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });
  const registry = createRoomRegistry();

  io.on("connection", (socket) => {
    const userCount = io.engine.clientsCount;
    console.log("a user connected", userCount);
    registerSocketHandlers(io, socket, registry);
  });

  return { app, server, io, registry };
}

if (require.main === module) {
  const { server } = createSignalingServer();
  server.listen(3000, () => {
    console.log("listening on *:3000");
  });
}

module.exports = {
  createHttpApp,
  createRoomRegistry,
  createSignalingServer,
  registerSocketHandlers,
};
