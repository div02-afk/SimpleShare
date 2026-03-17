import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  createHttpApp,
  createRoomRegistry,
  registerSocketHandlers,
} from "./src/index.js";

type RegisterSocketIo = Parameters<typeof registerSocketHandlers>[0];
type RegisterSocket = Parameters<typeof registerSocketHandlers>[1];

type ServerEventName =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "metadata"
  | "receiver-ready"
  | "receiver-error"
  | "receiver-finalizing"
  | "transfer-complete"
  | "received"
  | "room-ready"
  | "join-rejected"
  | "peer-left"
  | "ws-pong"
  | "peer-transport-state";

type ClientEventName =
  | "join-room"
  | "offer"
  | "answer"
  | "ice-candidate"
  | "metadata"
  | "receiver-ready"
  | "receiver-error"
  | "receiver-finalizing"
  | "transfer-complete"
  | "received"
  | "ws-ping"
  | "peer-transport-state"
  | "disconnect";

interface RecordedEvent {
  room?: string;
  event: string;
  payload: unknown;
}

function createFakeIo() {
  const emitted: RecordedEvent[] = [];

  return {
    emitted,
    to(room: string) {
      return {
        emit(event: ServerEventName, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
}

function createFakeSocket(id = "socket-1") {
  const handlers = new Map<ClientEventName, (payload?: unknown) => void>();
  const emitted: RecordedEvent[] = [];
  const relayed: RecordedEvent[] = [];
  const joinedRooms: string[] = [];

  return {
    id,
    emitted,
    relayed,
    joinedRooms,
    handlers,
    on(event: ClientEventName, handler: (payload?: unknown) => void) {
      handlers.set(event, handler);
    },
    emit(event: ServerEventName, payload: unknown) {
      emitted.push({ event, payload });
    },
    join(room: string) {
      joinedRooms.push(room);
    },
    to(room: string) {
      return {
        emit(event: ServerEventName, payload: unknown) {
          relayed.push({ room, event, payload });
        },
      };
    },
    trigger(event: ClientEventName, payload?: unknown) {
      const handler = handlers.get(event);
      if (!handler) {
        throw new Error(`No handler registered for ${event}`);
      }

      return handler(payload);
    },
  };
}

async function createHttpTestServer(
  getIceServers: () => Promise<RTCIceServer[]>
): Promise<{ close: () => Promise<void>; url: string }> {
  const app = createHttpApp({ getIceServers });
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
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

  registerSocketHandlers(io as RegisterSocketIo, sender as RegisterSocket, registry);
  registerSocketHandlers(
    io as RegisterSocketIo,
    receiver as RegisterSocket,
    registry
  );

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

  registerSocketHandlers(io as RegisterSocketIo, receiver as RegisterSocket, registry);
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

  registerSocketHandlers(io as RegisterSocketIo, sender as RegisterSocket, registry);
  registerSocketHandlers(
    io as RegisterSocketIo,
    receiver as RegisterSocket,
    registry
  );

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
  assert.equal(registry.getRoom("room-1")?.participants.receiver, null);
});

test("ws-ping responds with ws-pong", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const sender = createFakeSocket("sender-1");

  registerSocketHandlers(io as RegisterSocketIo, sender as RegisterSocket, registry);
  sender.trigger("ws-ping", { sentAt: 1234 });

  assert.equal(sender.emitted[0]?.event, "ws-pong");
  assert.equal(
    (sender.emitted[0]?.payload as { sentAt: number }).sentAt,
    1234
  );
  assert.equal(
    typeof (sender.emitted[0]?.payload as { serverTime: number }).serverTime,
    "number"
  );
});

test("peer-transport-state relays to the other participant", () => {
  const io = createFakeIo();
  const registry = createRoomRegistry();
  const sender = createFakeSocket("sender-1");

  registerSocketHandlers(io as RegisterSocketIo, sender as RegisterSocket, registry);
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

test("GET /ice-servers returns the raw ICE server array", async () => {
  const expectedIceServers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.cloudflare.com:3478",
        "stun:stun.cloudflare.com:53",
      ],
    },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
      ],
      username: "user",
      credential: "credential",
    },
  ];
  const server = await createHttpTestServer(async () => expectedIceServers);

  try {
    const response = await fetch(`${server.url}/ice-servers`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedIceServers);
  } finally {
    await server.close();
  }
});

test("GET /ice-servers returns 500 when fetching ICE servers fails", async () => {
  const server = await createHttpTestServer(async () => {
    throw new Error("boom");
  });

  try {
    const response = await fetch(`${server.url}/ice-servers`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Failed to fetch ICE servers",
    });
  } finally {
    await server.close();
  }
});

test("GET /turn is no longer supported", async () => {
  const server = await createHttpTestServer(async () => []);

  try {
    const response = await fetch(`${server.url}/turn`);

    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});
