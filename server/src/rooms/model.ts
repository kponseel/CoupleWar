import type {
  CoupleStats,
  CoupleView,
  GameMode,
  GameState,
  PlayerView,
  RoomSnapshot,
} from "@couplewar/shared";

/** Joueur interne (autorité serveur). */
export interface Player {
  id: string;
  name: string;
  coupleId: string | null;
  socketId: string | null;
  connected: boolean;
  isHost: boolean;
  ready: boolean;
  /** Échéance de suppression si déconnecté (§14, fenêtre de grâce). */
  disconnectedAt: number | null;
}

/** Couple interne. */
export interface Couple {
  id: string;
  name: string;
  playerIds: string[];
  joinCode: string | null;
  totalScore: number;
  stats: CoupleStats;
  /** Compteur de matchs Sync consécutifs (§5.3 étape 4). */
  syncStreak: number;
  /** Multiplicateur streak à appliquer au PROCHAIN round Sync. */
  pendingSyncMultiplier: boolean;
  handicap: string | null;
}

export function emptyStats(): CoupleStats {
  return {
    syncMatches: 0,
    syncTotal: 0,
    latencyGaps: [],
    predictionCorrect: 0,
    predictionTotal: 0,
    predictionDailyCorrect: 0,
    predictionDailyTotal: 0,
    predictionFutureCorrect: 0,
    predictionFutureTotal: 0,
    wavelengthDistances: [],
    emojiHits: 0,
    emojiTotal: 0,
    divergences: 0,
    socialVotes: 0,
  };
}

export function toPlayerView(p: Player): PlayerView {
  return {
    id: p.id,
    name: p.name,
    coupleId: p.coupleId,
    connected: p.connected,
    isHost: p.isHost,
    ready: p.ready,
  };
}

export function toCoupleView(c: Couple): CoupleView {
  return {
    id: c.id,
    name: c.name,
    players: [...c.playerIds],
    totalScore: c.totalScore,
    stats: c.stats,
    streak: c.syncStreak,
    handicap: c.handicap,
  };
}

export interface RoomData {
  roomCode: string;
  configVersion: string;
  minCouples: number;
  maxCouples: number;
  state: GameState;
  currentRound: number;
  totalRounds: number;
  currentMode: GameMode | null;
  isFinale: boolean;
  players: Map<string, Player>;
  couples: Map<string, Couple>;
}

export function buildSnapshot(room: RoomData): RoomSnapshot {
  return {
    roomCode: room.roomCode,
    state: room.state,
    configVersion: room.configVersion,
    minCouples: room.minCouples,
    maxCouples: room.maxCouples,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    currentMode: room.currentMode,
    isFinale: room.isFinale,
    players: [...room.players.values()].map(toPlayerView),
    couples: [...room.couples.values()].map(toCoupleView),
  };
}
