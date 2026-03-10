const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoomRegistry, registerSocketHandlers } = require("./index");

function createFakeIo() {
  const emitted = [];

  return {
    emitted,
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
}

function createFakeSocket(id = "socket-1") {
  const handlers = new Map();
  const emitted = [];
  const relayed = [];
  const joinedRooms = [];

  return {
    id,
    emitted,
    relayed,
    joinedRooms,
    handlers,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    join(room) {
      joinedRooms.push(room);
    },
    to(room) {
      return {
        emit(event, payload) {
          relayed.push({ room, event, payload });
        },
      };
    },
    trigger(event, payload) {
      const handler = handlers.get(event);
      if (!handler) {
        throw new Error(`No handler registered for ${event}`);
      }

      return handler(payload);
    },
  };
}

test("room registry enforces sender/receiver admission rules", () => {
  const registry = createRoomRegistry();

  assert.deepEqual(registry.join("room-1", "sender", "sender-1"), {
    accepted: true,
    roomReady: false,
  });
  assert.deepEqual(registry.join("room-1", "receiver", "receiver-1"), {
    accepted: true,
    roomReady: true,
  });
  assert.deepEqual(registry.join("room-1", "receiver", "receiver-2"), {
    accepted: false,
    reason: "duplicate-role",
  });
  assert.deepEqual(registry.join("room-1", "sender", "sender-2"), {
    accepted: false,
    reason: "duplicate-role",
  });
  assert.deepEqual(registry.join("missing", "receiver", "receiver-3"), {
    accepted: false,
    reason: "sender-not-found",
  });
});

test("join-room emits room-ready only after both roles are present", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const sender = createFakeSocket("sender-1");
  const receiver = createFakeSocket("receiver-1");

  registerSocketHandlers(io, sender, registry);
  registerSocketHandlers(io, receiver, registry);

  sender.trigger("join-room", { room: "room-1", role: "sender" });
  assert.deepEqual(io.emitted, []);

  receiver.trigger("join-room", { room: "room-1", role: "receiver" });

  assert.deepEqual(io.emitted, [
    {
      room: "room-1",
      event: "room-ready",
      payload: { room: "room-1" },
    },
  ]);
});

test("receiver join is rejected when no sender exists", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const receiver = createFakeSocket("receiver-1");

  registerSocketHandlers(io, receiver, registry);
  receiver.trigger("join-room", { room: "missing", role: "receiver" });

  assert.deepEqual(receiver.emitted, [
    {
      event: "join-rejected",
      payload: { room: "missing", reason: "sender-not-found" },
    },
  ]);
});

test("disconnect emits peer-left and clears the role", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const sender = createFakeSocket("sender-1");
  const receiver = createFakeSocket("receiver-1");

  registerSocketHandlers(io, sender, registry);
  registerSocketHandlers(io, receiver, registry);

  sender.trigger("join-room", { room: "room-1", role: "sender" });
  receiver.trigger("join-room", { room: "room-1", role: "receiver" });
  receiver.trigger("disconnect");

  assert.deepEqual(receiver.relayed, [
    {
      room: "room-1",
      event: "peer-left",
      payload: { room: "room-1", role: "receiver" },
    },
  ]);
  assert.equal(registry.getRoom("room-1").participants.receiver, null);
});

test("ws-ping responds with ws-pong", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const sender = createFakeSocket("sender-1");

  registerSocketHandlers(io, sender, registry);
  sender.trigger("ws-ping", { sentAt: 1234 });

  assert.equal(sender.emitted[0].event, "ws-pong");
  assert.equal(sender.emitted[0].payload.sentAt, 1234);
  assert.equal(typeof sender.emitted[0].payload.serverTime, "number");
});

test("peer-transport-state relays to the other participant", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const sender = createFakeSocket("sender-1");

  registerSocketHandlers(io, sender, registry);
  sender.trigger("peer-transport-state", {
    room: "room-1",
    role: "sender",
    state: "degraded",
  });

  assert.deepEqual(sender.relayed, [
    {
      room: "room-1",
      event: "peer-transport-state",
      payload: {
        room: "room-1",
        role: "sender",
        state: "degraded",
      },
    },
  ]);
});
