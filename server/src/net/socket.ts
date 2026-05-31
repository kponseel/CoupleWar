import type { Server, Socket } from "socket.io";
import type { ClientToServer, ServerToClient } from "@couplewar/shared";
import { clock } from "../engine/clock.js";
import type { RoomManager } from "../rooms/RoomManager.js";
import type { Room } from "../rooms/Room.js";
import { TokenBucket, DEFAULT_RATE } from "./rateLimit.js";

interface SocketData {
  roomCode: string | null;
  playerId: string | null;
}

type CWSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Vrai si `v` est une string non vide et ≤ maxLen (validation d'entrée). */
function isStr(v: unknown, maxLen = 64): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
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

    // Rate limiting par socket : un client qui spamme des événements est ignoré
    // (token bucket). Limites larges → invisible pour un joueur normal.
    const bucket = new TokenBucket(DEFAULT_RATE);
    socket.use((_event, next) => {
      if (bucket.take()) return next();
      // Au-delà de la limite : on droppe l'événement silencieusement (pas d'ack).
      next(new Error("rate_limited"));
    });
    // Évite un crash : une erreur de middleware est émise sur le socket.
    socket.on("error", () => {
      /* erreur de rate-limit / middleware : ignorée côté serveur */
    });

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

    socket.on("room:join", (p, cb) => {
      const ack = safeAck(cb);
      // Validation d'entrée : un payload non conforme ne doit jamais crasher le handler.
      if (!isObject(p) || !isStr(p.roomCode, 12) || !isStr(p.name, 24)) {
        return ack({ ok: false, error: "bad_payload" });
      }
      const room = rooms.get(p.roomCode);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      if (room.data.state !== "LOBBY" && room.data.state !== "PAIRING") {
        return ack({ ok: false, error: "game_already_started" });
      }
      const player = room.addPlayer(socket.id, p.name, false);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      ack({ ok: true, data: { playerId: player.id, roomCode: room.code } });
    });

    socket.on("room:resume", (p, cb) => {
      const ack = safeAck(cb);
      if (!isObject(p) || !isStr(p.roomCode, 12) || !isStr(p.playerId, 64)) {
        return ack({ ok: false, error: "bad_payload" });
      }
      const room = rooms.get(p.roomCode);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      const player = room.resumePlayer(p.playerId, socket.id);
      if (!player) return ack({ ok: false, error: "unknown_player" });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      ack({ ok: true, data: { playerId: player.id, roomCode: room.code } });
    });

    // --- Pairing (§4) ---
    const withRoom = <T>(cb: unknown, fn: (room: Room, playerId: string) => { error: string } | T): void => {
      const ack = safeAck<T>(cb);
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return ack({ ok: false, error: "no_session" });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      const res = fn(room, pid);
      if (typeof res === "object" && res !== null && "error" in res) {
        return ack({ ok: false, error: (res as { error: string }).error });
      }
      ack({ ok: true, data: res as T });
    };

    /** Le joueur n'agit que sur SON couple (autorisation). */
    const ownsCouple = (room: Room, pid: string, coupleId: unknown): boolean =>
      isStr(coupleId, 64) && room.data.players.get(pid)?.coupleId === coupleId;

    socket.on("pairing:createCouple", (cb) => {
      withRoom(cb, (room, pid) => room.createCouple(pid));
    });
    socket.on("pairing:joinCouple", (p, cb) => {
      withRoom(cb, (room, pid) =>
        isObject(p) && isStr(p.joinCode, 8) ? room.joinCouple(pid, p.joinCode) : { error: "bad_payload" },
      );
    });
    socket.on("pairing:rerollName", (p, cb) => {
      withRoom(cb, (room, pid) =>
        isObject(p) && ownsCouple(room, pid, p.coupleId)
          ? room.rerollName(p.coupleId as string)
          : { error: "not_your_couple" },
      );
    });
    socket.on("pairing:setName", (p, cb) => {
      withRoom(cb, (room, pid) =>
        isObject(p) && ownsCouple(room, pid, p.coupleId) && isStr(p.name, 40)
          ? room.setCoupleName(p.coupleId as string, p.name)
          : { error: "not_your_couple" },
      );
    });
    socket.on("pairing:ready", (p, cb) => {
      const ack = safeAck(cb);
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return ack({ ok: false, error: "no_session" });
      if (!isObject(p) || typeof p.ready !== "boolean") return ack({ ok: false, error: "bad_payload" });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      room.setReady(pid, p.ready);
      ack({ ok: true, data: { ready: p.ready } });
    });

    // --- Démarrage (host) ---
    socket.on("game:start", (cb) => {
      const ack = safeAck(cb);
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return ack({ ok: false, error: "no_session" });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      const player = room.data.players.get(pid);
      if (!player?.isHost) return ack({ ok: false, error: "not_host" });
      const res = room.startGame();
      if (!res.ok) return ack({ ok: false, error: res.reason ?? "cannot_start" });
      ack({ ok: true, data: { started: true } });
    });

    // --- Forcer la révélation (host, anti-blocage §A3) ---
    socket.on("game:forceReveal", (cb) => {
      const ack = safeAck(cb);
      const code = socket.data.roomCode;
      const pid = socket.data.playerId;
      if (!code || !pid) return ack({ ok: false, error: "no_session" });
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, error: "room_not_found" });
      const res = room.forceReveal(pid);
      if (!res.forced) return ack({ ok: false, error: res.reason ?? "cannot_force" });
      ack({ ok: true, data: { forced: true } });
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
