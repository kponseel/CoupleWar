/** Types de domaine partagés client ↔ serveur. */

export type Intensity = "light" | "medium" | "deep";
export type GameMode = "sync" | "wavelength" | "auction" | "mime_d1" | "mime_d2" | "mime_d3";

/** État global de la room — machine à états §2. */
export type GameState =
  | "LOBBY"
  | "PAIRING"
  | "ROUND_INTRO"
  | "ROUND_PLAY"
  | "ROUND_REVEAL"
  | "INTERLUDE"
  | "FINALE"
  | "RESULTS"
  | "END";

/** Question (contrat content team ↔ moteur §12.1). */
export interface Question {
  id: string;
  mode: GameMode;
  intensity: Intensity;
  category?: string;
  spicy?: boolean;
  tags?: string[];
  text: string;
  options?: string[];
  wavelength?: { poleLeft: string; poleRight: string };
  mime?: { secret: string };
}

/** Vue publique d'un joueur (diffusée). */
export interface PlayerView {
  id: string;
  name: string;
  coupleId: string | null;
  connected: boolean;
  isHost: boolean;
  ready: boolean;
}

/** Stats brutes trackées par couple (§12.2). */
export interface CoupleStats {
  syncMatches: number;
  syncTotal: number;
  latencyGaps: number[];
  predictionCorrect: number;
  predictionTotal: number;
  // Prédiction ventilée par tag pour le titre « Couple-Coloc » §9.2 / §7.4.
  predictionDailyCorrect: number;
  predictionDailyTotal: number;
  predictionFutureCorrect: number;
  predictionFutureTotal: number;
  wavelengthDistances: number[];
  emojiHits: number;
  emojiTotal: number;
  divergences: number;
  socialVotes: number;
}

/** Vue publique d'un couple (diffusée). */
export interface CoupleView {
  id: string;
  name: string;
  players: string[]; // player ids
  totalScore: number;
  stats: CoupleStats;
  streak: number;
  handicap: string | null;
}

/** Snapshot complet de la room envoyé aux clients. */
export interface RoomSnapshot {
  roomCode: string;
  state: GameState;
  configVersion: string;
  currentRound: number; // 1-based, 0 hors round
  totalRounds: number;
  currentMode: GameMode | null;
  isFinale: boolean;
  players: PlayerView[];
  couples: CoupleView[];
}

/** Entrée de leaderboard (rendu §10.3). */
export interface LeaderboardEntry {
  coupleId: string;
  name: string;
  totalScore: number;
  syncRate: number; // 0..1 (SyncMètre)
  rank: number; // 1-based
}

/** Médaille secondaire (§9.3). */
export interface Medal {
  key: string;
  label: string;
  emoji: string;
}

/** Résultat final par couple (§9). */
export interface CoupleResult {
  coupleId: string;
  name: string;
  totalScore: number;
  rank: number;
  title: { key: string; label: string; emoji: string; blurb: string };
  medal: Medal | null;
  compatibility: number; // >= compatFloor
  metaphor: string;
  computedStats: {
    syncRate: number;
    predictionRate: number;
    latencyGapMedian: number;
    wavelengthAccuracy: number;
    emojiHits: number;
    divergenceScore: number;
    socialVotes: number;
  };
}
