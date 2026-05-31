import type { Server, Socket } from "socket.io";
import type { ClientToServer, ServerToClient } from "@couplewar/shared";
import { clock } from "../engine/clock.js";
import type { RoomManager } from "../rooms/RoomManager.js";
import type { Room } from "../rooms/Room.js";

interface SocketData {
  roomCode: string | null;
  playerId: string | null;
}

type CWSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Enveloppe un ack pour ne jamais lever si le client n'a pas fourni de callback
 * (un client malveillant peut émettre sans ack → un appel direct planterait).
 */
function safeAck<T>(cb: unknown): (res: { ok: true; data: T } | { ok: false; error: string }) => void {
  return (res) => {
    if (typeof cb === "function") {
      try {
        (cb as (r: unknown) => void)(res);
      } catch {
        /* ack injoignable : on ignore */
      }
    }
  };
}

/** Câble les événements Socket.io aux méthodes de Room (autorité serveur). */
export function registerSocketHandlers(io: Server, rooms: RoomManager): void {
  io.on("connection", (rawSocket) => {
    const socket = rawSocket as unknown as CWSocket;
    socket.data.roomCode = null;
    socket.data.playerId = null;

    // --- Synchro d'horloge (§3.2) : ack avec le temps serveur ---
    socket.on("clock:ping", (cb) => {
      if (typeof cb === "function") cb(clock.now());
    });

    // --- Room / lobby ---
    socket.on("room:create", (cb) => {
      const room = rooms.createRoom();
      const player = room.addPlayer(socket.id, "Host", true);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      cb({ ok: true, data: { roomCode: room.code, playerId: player.id, isHost: true } });
    });

    socket.on("room:join", ({ roomCode, name }, cb) => {
      const room = rooms.get(roomCode);
      if (!room) return cb({ ok: false, error: "room_not_found" });
      if (room.data.state !== "LOBBY" && room.data.state !== "PAIRING") {
        return cb({ ok: false, error: "game_already_started" });
      }
      const player = room.addPlayer(socket.id, name, false);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      cb({ ok: true, data: { playerId: player.id, roomCode: room.code } });
    });

    socket.on("room:resume", ({ roomCode, playerId }, cb) => {
      const room = rooms.get(roomCode);
      if (!room) return cb({ ok: false, error: "room_not_found" });
      const player = room.resumePlayer(playerId, socket.id);
      if (!player) return cb({ ok: false, error: "unknown_player" });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      cb({ ok: true, data: { playerId: player.id, roomCode: room.code } });
    });

    // --- Pairing (§4) ---
    const withRoom = <T>(cb: (res: { ok: false; error: string } | { ok: true; data: T }) => void, fn: (room: Room, playerId: string) => { error: string } | T): void => {
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return cb({ ok: false, error: "no_session" });
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: "room_not_found" });
      const res = fn(room, pid);
      if (typeof res === "object" && res !== null && "error" in res) {
        return cb({ ok: false, error: (res as { error: string }).error });
      }
      cb({ ok: true, data: res as T });
    };

    socket.on("pairing:createCouple", (cb) => {
      withRoom(cb, (room, pid) => room.createCouple(pid));
    });
    socket.on("pairing:joinCouple", ({ joinCode }, cb) => {
      withRoom(cb, (room, pid) => room.joinCouple(pid, joinCode));
    });
    socket.on("pairing:tapPair", (_p, cb) => {
      // Tap-to-pair simplifié au MVP : on s'appuie sur le code de couple (§4.2 méthode 1).
      cb({ ok: false, error: "use_join_code" });
    });
    socket.on("pairing:rerollName", ({ coupleId }, cb) => {
      withRoom(cb, (room) => room.rerollName(coupleId));
    });
    socket.on("pairing:setName", ({ coupleId, name }, cb) => {
      withRoom(cb, (room) => room.setCoupleName(coupleId, name));
    });
    socket.on("pairing:ready", ({ ready }, cb) => {
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return cb({ ok: false, error: "no_session" });
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: "room_not_found" });
      room.setReady(pid, ready);
      cb({ ok: true, data: { ready } });
    });

    // --- Démarrage (host) ---
    socket.on("game:start", (cb) => {
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return cb({ ok: false, error: "no_session" });
      const room = rooms.get(code);
      if (!room) return cb({ ok: false, error: "room_not_found" });
      const player = room.data.players.get(pid);
      if (!player?.isHost) return cb({ ok: false, error: "not_host" });
      const res = room.startGame();
      if (!res.ok) return cb({ ok: false, error: res.reason ?? "cannot_start" });
      cb({ ok: true, data: { started: true } });
    });

    // --- Jeu ---
    socket.on("answer:submit", (payload, cb) => {
      const ack = safeAck(cb);
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return ack({ ok: false, error: "no_session" });
      if (!isObject(payload)) return ack({ ok: false, error: "bad_payload" });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      const res = room.submitAnswer(pid, payload);
      ack({ ok: true, data: { accepted: res.accepted, reason: res.reason } });
    });

    socket.on("auction:bet", (payload, cb) => {
      const ack = safeAck(cb);
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return ack({ ok: false, error: "no_session" });
      if (!isObject(payload)) return ack({ ok: false, error: "bad_payload" });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      const res = room.submitBet(pid, payload);
      ack({ ok: true, data: { accepted: res.accepted, reason: res.reason } });
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (code && pid) {
        rooms.get(code)?.handleDisconnect(pid);
      }
    });
  });
}
