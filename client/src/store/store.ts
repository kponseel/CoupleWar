import { create } from "zustand";
import type {
  CoupleResult,
  GameMode,
  LeaderboardEntry,
  PlayPayload,
  RevealPayload,
  RoomSnapshot,
} from "@couplewar/shared";
import { socket } from "../net/socket.js";
import { clientSubmitTime } from "../net/clock.js";
import { sfx, unlockAudio } from "../audio/audio.js";

type Role = "host" | "player" | null;

interface IntroState {
  round: number;
  mode: GameMode;
  rule: string;
  isFinale: boolean;
}

interface LeaderboardState {
  entries: LeaderboardEntry[];
  rowPauseMs: number;
  topReserved: boolean;
}

interface FlashState {
  color: string;
  durationMs: number;
  nonce: number;
}

interface AppState {
  connected: boolean;
  clockReady: boolean;
  role: Role;
  playerId: string | null;
  roomCode: string | null;
  error: string | null;

  snapshot: RoomSnapshot | null;
  intro: IntroState | null;
  play: PlayPayload | null;
  answered: boolean;
  betPlaced: boolean;
  isTargetThisRound: boolean;
  reveal: RevealPayload | null;
  leaderboard: LeaderboardState | null;
  results: CoupleResult[] | null;
  flash: FlashState | null;
  heartbeatCoupleId: string | null;

  // setters (events serveur)
  set: (partial: Partial<AppState>) => void;
  reset: () => void;

  // actions (intentions client)
  createRoom: () => Promise<void>;
  joinRoom: (name: string, code: string) => Promise<void>;
  createCouple: () => Promise<{ joinCode: string } | null>;
  joinCouple: (code: string) => Promise<boolean>;
  rerollName: (coupleId: string) => Promise<void>;
  setCoupleName: (coupleId: string, name: string) => Promise<void>;
  toggleReady: (ready: boolean) => Promise<void>;
  startGame: () => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  submitBet: (option: string, tokens: number) => Promise<void>;
}

const ACK_TIMEOUT_MS = 8000;

/**
 * Émet un événement et attend l'ACK serveur, avec un TIMEOUT (§14) : si la
 * connexion tombe pendant l'envoi, la promesse se résout en échec plutôt que de
 * rester pendante à jamais (sinon l'état optimiste answered/betPlaced/resuming
 * ne serait jamais réconcilié).
 */
function emitAck<T>(event: string, payload?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; data?: T; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: "timeout" }), ACK_TIMEOUT_MS);
    const cb = (res: { ok: true; data: T } | { ok: false; error: string }) =>
      done(res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error });
    if (payload === undefined) (socket.emit as (e: string, c: unknown) => void)(event, cb);
    else (socket.emit as (e: string, p: unknown, c: unknown) => void)(event, payload, cb);
  });
}

const STORAGE_KEY = "couplewar.session";

function saveSession(role: Role, roomCode: string | null, playerId: string | null): void {
  try {
    if (role && roomCode && playerId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ role, roomCode, playerId }));
    }
  } catch {
    /* ignore */
  }
}

export function loadSession(): { role: Role; roomCode: string; playerId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const initial = {
  connected: false,
  clockReady: false,
  role: null as Role,
  playerId: null as string | null,
  roomCode: null as string | null,
  error: null as string | null,
  snapshot: null as RoomSnapshot | null,
  intro: null as IntroState | null,
  play: null as PlayPayload | null,
  answered: false,
  betPlaced: false,
  isTargetThisRound: false,
  reveal: null as RevealPayload | null,
  leaderboard: null as LeaderboardState | null,
  results: null as CoupleResult[] | null,
  flash: null as FlashState | null,
  heartbeatCoupleId: null as string | null,
};

export const useStore = create<AppState>((set, get) => ({
  ...initial,

  set: (partial) => set(partial),
  reset: () => {
    clearSession();
    set({ ...initial, connected: get().connected, clockReady: get().clockReady });
  },

  async createRoom() {
    unlockAudio();
    const res = await emitAck<{ roomCode: string; playerId: string }>("room:create");
    if (res.ok && res.data) {
      saveSession("host", res.data.roomCode, res.data.playerId);
      set({ role: "host", roomCode: res.data.roomCode, playerId: res.data.playerId, error: null });
    } else {
      set({ error: res.error ?? "create_failed" });
    }
  },

  async joinRoom(name, code) {
    unlockAudio();
    const res = await emitAck<{ playerId: string; roomCode: string }>("room:join", {
      roomCode: code.toUpperCase(),
      name,
    });
    if (res.ok && res.data) {
      saveSession("player", res.data.roomCode, res.data.playerId);
      set({ role: "player", roomCode: res.data.roomCode, playerId: res.data.playerId, error: null });
    } else {
      set({ error: res.error ?? "join_failed" });
    }
  },

  async createCouple() {
    const res = await emitAck<{ coupleId: string; joinCode: string }>("pairing:createCouple");
    if (res.ok && res.data) return { joinCode: res.data.joinCode };
    set({ error: res.error ?? "couple_failed" });
    return null;
  },

  async joinCouple(code) {
    const res = await emitAck<{ coupleId: string }>("pairing:joinCouple", { joinCode: code });
    if (!res.ok) set({ error: res.error ?? "bad_code" });
    return res.ok;
  },

  async rerollName(coupleId) {
    await emitAck("pairing:rerollName", { coupleId });
  },

  async setCoupleName(coupleId, name) {
    await emitAck("pairing:setName", { coupleId, name });
  },

  async toggleReady(ready) {
    await emitAck("pairing:ready", { ready });
  },

  async startGame() {
    const res = await emitAck<{ started: boolean }>("game:start");
    if (!res.ok) set({ error: res.error ?? "cannot_start" });
  },

  async submitAnswer(answer) {
    const play = get().play;
    if (!play || get().answered) return;
    set({ answered: true });
    sfx.tap();
    const res = await emitAck<{ accepted: boolean; reason?: string }>("answer:submit", {
      questionId: play.questionId,
      answer,
      clientSubmitTime: clientSubmitTime(),
    });
    if (!(res.ok && res.data?.accepted)) {
      set({ answered: false, error: res.data?.reason ?? res.error ?? "rejected" });
      sfx.fail();
    }
  },

  async submitBet(option, tokens) {
    const play = get().play;
    if (!play || get().betPlaced) return;
    set({ betPlaced: true });
    sfx.tap();
    const res = await emitAck<{ accepted: boolean; reason?: string }>("auction:bet", {
      questionId: play.questionId,
      option,
      tokens,
    });
    if (!(res.ok && res.data?.accepted)) {
      set({ betPlaced: false, error: res.data?.reason ?? res.error ?? "rejected" });
      sfx.fail();
    }
  },
}));

/** Sélecteur : l'id du couple du joueur courant. */
export function selectMyCoupleId(s: AppState): string | null {
  if (!s.snapshot || !s.playerId) return null;
  return s.snapshot.players.find((p) => p.id === s.playerId)?.coupleId ?? null;
}
