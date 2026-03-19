import cors from "cors";
import crypto from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { Server, type Socket } from "socket.io";
import { getIceServers } from "./ice.js";

type TransportRole = "sender" | "receiver";
type JoinRejectedReason = "sender-not-found" | "duplicate-role" | "room-full";

interface JoinRoomPayload {
  room?: string;
  role?: TransportRole;
}

interface RoomPayload {
  room: string;
}

interface JoinRejectedPayload extends RoomPayload {
  reason: JoinRejectedReason;
}

interface PeerLeftPayload extends RoomPayload {
  role: TransportRole;
}

interface WebSocketPingPayload {
  sentAt?: number;
}

interface WebSocketPongPayload {
  sentAt: number;
  serverTime: number;
}

interface PeerTransportStatePayload extends RoomPayload {
  role: TransportRole;
  state: string;
}

interface OfferPayload extends RoomPayload {
  offer: RTCSessionDescriptionInit;
  connectionId: number;
}

interface AnswerPayload extends RoomPayload {
  answer: RTCSessionDescriptionInit;
  connectionId: number;
}

interface IceCandidatePayload extends RoomPayload {
  candidate: RTCIceCandidateInit;
  sender: TransportRole;
  connectionId: number;
}

interface ReceiverReadyPayload extends RoomPayload {
  writeMode: string;
  compressionMode?: string;
}

interface ReceiverErrorPayload extends RoomPayload {
  error: string;
}

interface ReceivedPayload extends RoomPayload {
  logicalBytesReceived: number;
  wireBytesReceived: number;
}

interface TransferMetadata extends RoomPayload {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  chunkSize: number;
  totalChunks: number;
  compressionMode?: string;
}

interface ClientToServerEvents {
  "join-room": (payload: JoinRoomPayload) => void;
  offer: (payload: OfferPayload) => void;
  answer: (payload: AnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  metadata: (payload: TransferMetadata) => void;
  "receiver-ready": (payload: ReceiverReadyPayload) => void;
  "receiver-error": (payload: ReceiverErrorPayload) => void;
  "receiver-finalizing": (payload: RoomPayload) => void;
  "transfer-complete": (payload: RoomPayload) => void;
  received: (payload: ReceivedPayload) => void;
  "ws-ping": (payload?: WebSocketPingPayload) => void;
  "peer-transport-state": (payload: PeerTransportStatePayload) => void;
}

interface ServerToClientEvents {
  offer: (payload: OfferPayload) => void;
  answer: (payload: AnswerPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  metadata: (payload: TransferMetadata) => void;
  "receiver-ready": (payload: ReceiverReadyPayload) => void;
  "receiver-error": (payload: ReceiverErrorPayload) => void;
  "receiver-finalizing": (payload: RoomPayload) => void;
  "transfer-complete": (payload: RoomPayload) => void;
  received: (payload: ReceivedPayload) => void;
  "room-ready": (payload: RoomPayload) => void;
  "join-rejected": (payload: JoinRejectedPayload) => void;
  "peer-left": (payload: PeerLeftPayload) => void;
  "ws-pong": (payload: WebSocketPongPayload) => void;
  "peer-transport-state": (payload: PeerTransportStatePayload) => void;
}

type ServerEventMap = {
  [EventName in keyof ServerToClientEvents]: Parameters<
    ServerToClientEvents[EventName]
  >[0];
};

interface RoomState {
  participants: Record<TransportRole, string | null>;
}

interface ParticipantRecord {
  roomId: string;
  role: TransportRole;
}

interface RoomRegistryMetrics {
  roomCount: number;
  participantCount: number;
  readyRoomCount: number;
}

type JoinResult =
  | { accepted: true; roomReady: boolean }
  | { accepted: false; reason: JoinRejectedReason };

interface RoomRegistry {
  getRoom: (roomId: string) => RoomState | null;
  join: (roomId: string, role: TransportRole, socketId: string) => JoinResult;
  removeSocket: (socketId: string) => ParticipantRecord | null;
  getMetrics: () => RoomRegistryMetrics;
}

interface RoomEmitter {
  emit(event: keyof ServerEventMap, payload: ServerEventMap[keyof ServerEventMap]): unknown;
}

interface IoLike {
  to(room: string): RoomEmitter;
}

interface SocketLike {
  id: string;
  on(event: "join-room", handler: (payload: JoinRoomPayload) => void): unknown;
  on(event: "offer", handler: (payload: OfferPayload) => void): unknown;
  on(event: "answer", handler: (payload: AnswerPayload) => void): unknown;
  on(
    event: "ice-candidate",
    handler: (payload: IceCandidatePayload) => void
  ): unknown;
  on(event: "metadata", handler: (payload: TransferMetadata) => void): unknown;
  on(
    event: "receiver-ready",
    handler: (payload: ReceiverReadyPayload) => void
  ): unknown;
  on(
    event: "receiver-error",
    handler: (payload: ReceiverErrorPayload) => void
  ): unknown;
  on(
    event: "receiver-finalizing",
    handler: (payload: RoomPayload) => void
  ): unknown;
  on(
    event: "transfer-complete",
    handler: (payload: RoomPayload) => void
  ): unknown;
  on(event: "received", handler: (payload: ReceivedPayload) => void): unknown;
  on(
    event: "ws-ping",
    handler: (payload?: WebSocketPingPayload) => void
  ): unknown;
  on(
    event: "peer-transport-state",
    handler: (payload: PeerTransportStatePayload) => void
  ): unknown;
  on(event: "disconnect", handler: () => void): unknown;
  emit(event: keyof ServerEventMap, payload: ServerEventMap[keyof ServerEventMap]): unknown;
  join(room: string): void;
  to(room: string): RoomEmitter;
}

export function createRoomRegistry(): RoomRegistry {
  const rooms = new Map<string, RoomState>();
  const socketToParticipant = new Map<string, ParticipantRecord>();

  const getRoom = (roomId: string): RoomState | null => rooms.get(roomId) ?? null;

  const ensureRoom = (roomId: string): RoomState => {
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

  const join = (
    roomId: string,
    role: TransportRole,
    socketId: string
  ): JoinResult => {
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

  const removeSocket = (socketId: string): ParticipantRecord | null => {
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

  const getMetrics = (): RoomRegistryMetrics => {
    let readyRoomCount = 0;

    for (const room of rooms.values()) {
      if (room.participants.sender && room.participants.receiver) {
        readyRoomCount += 1;
      }
    }

    return {
      roomCount: rooms.size,
      participantCount: socketToParticipant.size,
      readyRoomCount,
    };
  };

  return {
    getRoom,
    join,
    removeSocket,
    getMetrics,
  };
}

function relayToPeer<EventName extends Exclude<keyof ServerEventMap, "ws-pong">>(
  socket: Pick<SocketLike, "to">,
  roomId: string,
  eventName: EventName,
  payload: ServerEventMap[EventName]
): void {
  socket.to(roomId).emit(eventName, payload);
}

function isTransportRole(role: string | undefined): role is TransportRole {
  return role === "sender" || role === "receiver";
}

export function registerSocketHandlers(
  io: IoLike,
  socket: SocketLike,
  registry: RoomRegistry
): void {
  socket.on("join-room", (payload) => {
    const roomId = payload?.room;
    const role = payload?.role;

    if (!roomId || !isTransportRole(role)) {
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

export interface HttpAppDependencies {
  getIceServers?: () => Promise<RTCIceServer[]>;
  getHealthSnapshot?: () => RoomRegistryMetrics & { websocketConnections: number };
}

export function createHttpApp(dependencies: HttpAppDependencies = {}): Express {
  const app = express();
  const fetchIceServers = dependencies.getIceServers ?? getIceServers;
  const getHealthSnapshot =
    dependencies.getHealthSnapshot ??
    (() => ({
      websocketConnections: 0,
      roomCount: 0,
      participantCount: 0,
      readyRoomCount: 0,
    }));
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST"],
    })
  );
  app.get("/random", (_req, res) => {
    const randomId = crypto.randomBytes(2).toString("hex");
    res.send(randomId);
  });

  app.get("/ice-servers", async (_req, res) => {
    try {
      const iceServers = await fetchIceServers();
      res.json(iceServers);
    } catch (error) {
      console.error("Error fetching ICE servers:", error);
      res.status(500).json({ error: "Failed to fetch ICE servers" });
    }
  });

  app.get("/healthz", (_req, res) => {
    const snapshot = getHealthSnapshot();

    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      metrics: {
        websocketConnections: snapshot.websocketConnections,
        rooms: snapshot.roomCount,
        roomParticipants: snapshot.participantCount,
        readyRooms: snapshot.readyRoomCount,
      },
    });
  });

  return app;
}

export interface SignalingServer {
  app: Express;
  server: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  registry: RoomRegistry;
}

export function createSignalingServer(): SignalingServer {
  const registry = createRoomRegistry();
  let getWebSocketConnections = () => 0;
  const app = createHttpApp({
    getHealthSnapshot: () => ({
      websocketConnections: getWebSocketConnections(),
      ...registry.getMetrics(),
    }),
  });
  const server = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: {
      origin: "*",
    },
  });
  getWebSocketConnections = () => io.engine.clientsCount;

  io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const userCount = io.engine.clientsCount;
    console.log("a user connected", userCount);
    registerSocketHandlers(io, socket, registry);
  });

  return { app, server, io, registry };
}

const isMainModule =
  process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const { server } = createSignalingServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`listening on *:${port}`);
  });
}
