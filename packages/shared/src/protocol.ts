/**
 * Contrat de protocole Socket.io (client ↔ serveur).
 * Le serveur est l'autorité : le client envoie des intentions, reçoit des états/FX.
 */
import type {
  CoupleResult,
  GameMode,
  LeaderboardEntry,
  Question,
  RoomSnapshot,
} from "./types.js";

/** Réponses d'ACK génériques. */
export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

// ---------------------------------------------------------------------------
// Payloads jeu
// ---------------------------------------------------------------------------

/** Question telle qu'envoyée en ROUND_PLAY — JAMAIS la réponse/secret. */
export interface PlayPayloadSync {
  mode: "sync";
  questionId: string;
  text: string;
  options: string[];
  serverStartTime: number; // horloge maître (ms)
  deadline: number; // horloge maître (ms)
}

/** Mode Enchères — phases successives (§7.2). */
export interface AuctionAnswerPhase {
  mode: "auction";
  phase: "answer";
  questionId: string;
  text: string;
  options: string[]; // 4 pré-générées + "autre"
  targetPlayerId: string; // le Cible
  serverStartTime: number;
  deadline: number;
}
export interface AuctionBetPhase {
  mode: "auction";
  phase: "bet";
  questionId: string;
  text: string;
  options: string[]; // options révélées (sans la réponse du Cible)
  targetCoupleId: string;
  tokensPerRound: number;
  minBet: number;
  maxBet: number;
  serverStartTime: number;
  deadline: number;
}

/** Wavelength (§6) — phase « indice » : l'Émetteur voit la cible et tape un mot. */
export interface WavelengthCluePhase {
  mode: "wavelength";
  phase: "clue";
  questionId: string;
  text: string;
  poleLeft: string;
  poleRight: string;
  emitterPlayerId: string;
  emitterCoupleId: string;
  /** Cible 0..100, envoyée UNIQUEMENT à l'Émetteur. */
  target?: number;
  clueMaxChars: number;
  serverStartTime: number;
  deadline: number;
}

/** Wavelength — phase « réception + paris » : indice révélé à tous. */
export interface WavelengthReceptionPhase {
  mode: "wavelength";
  phase: "reception";
  questionId: string;
  text: string;
  poleLeft: string;
  poleRight: string;
  clue: string;
  emitterCoupleId: string;
  receiverPlayerId: string;
  serverStartTime: number;
  deadline: number;
}

/**
 * Mime D3 — Canal d'emojis (§8.3). Un seul payload pour toute la manche.
 * Le `secret` n'est envoyé QU'AU Donneur (filtré par la Room). La main d'emojis
 * (`hand`) aussi. Récepteur et autres couples reçoivent le payload sans secret
 * ni main, et voient les emojis arriver via l'événement `mime:emoji`.
 */
export interface MimeEmojiPhase {
  mode: "mime_d3";
  phase: "play";
  questionId: string;
  text: string;
  giverPlayerId: string;
  giverCoupleId: string;
  receiverPlayerId: string;
  /** Concept secret — UNIQUEMENT pour le Donneur. */
  secret?: string;
  /** Main d'emojis tirée — UNIQUEMENT pour le Donneur. */
  hand?: string[];
  emojiCooldownMs: number;
  guessMaxChars: number;
  serverStartTime: number;
  deadline: number;
}

export type PlayPayload =
  | PlayPayloadSync
  | AuctionAnswerPhase
  | AuctionBetPhase
  | WavelengthCluePhase
  | WavelengthReceptionPhase
  | MimeEmojiPhase;

/** Reveal couple-par-couple générique (§5.2 / §7.3). */
export interface RevealPayload {
  mode: GameMode;
  questionId: string;
  executeAt: number; // FX synchronisé (§10.2)
  correctAnswer?: string;
  perCouple: Array<{
    coupleId: string;
    name: string;
    detail: Record<string, unknown>; // libre selon le mode (match, gap, gains…)
    deltaScore: number;
    heartbeat?: boolean; // Cœur Battant déclenché
  }>;
}

/** FX synchronisé multi-écrans (§10.2). */
export interface FxEvent {
  kind: "flash" | "drumroll" | "hearts" | "heartbeat";
  executeAt: number;
  color?: string;
  durationMs?: number;
  coupleId?: string; // cible (pluie de cœurs sur un couple)
}

// ---------------------------------------------------------------------------
// Client → Serveur
// ---------------------------------------------------------------------------
export interface ClientToServer {
  // Synchro d'horloge (§3.2) : ack renvoie le temps serveur.
  "clock:ping": (cb: (serverTime: number) => void) => void;

  // Room / lobby
  "room:create": (cb: Ack<{ roomCode: string; playerId: string; isHost: true }>) => void;
  "room:join": (
    p: { roomCode: string; name: string },
    cb: Ack<{ playerId: string; roomCode: string }>,
  ) => void;
  "room:resume": (
    p: { roomCode: string; playerId: string },
    cb: Ack<{ playerId: string; roomCode: string }>,
  ) => void;

  // Pairing (§4.2 / §4.3)
  "pairing:createCouple": (cb: Ack<{ coupleId: string; joinCode: string; names: string[] }>) => void;
  "pairing:joinCouple": (p: { joinCode: string }, cb: Ack<{ coupleId: string }>) => void;
  "pairing:rerollName": (p: { coupleId: string }, cb: Ack<{ names: string[] }>) => void;
  "pairing:setName": (p: { coupleId: string; name: string }, cb: Ack<{ name: string }>) => void;
  "pairing:ready": (p: { ready: boolean }, cb: Ack<{ ready: boolean }>) => void;

  // Contrôle host. `solo` (optionnel) autorise 1 seul couple (dev/test).
  "game:start": (p: { solo?: boolean }, cb: Ack<{ started: boolean }>) => void;
  // Anti-blocage : l'hôte force la fin de la phase de jeu en cours (§A3).
  "game:forceReveal": (cb: Ack<{ forced: boolean }>) => void;

  // Réponses de jeu (datées via offset client §3.3)
  "answer:submit": (
    p: { questionId: string; answer: string; clientSubmitTime: number },
    cb: Ack<{ accepted: boolean; reason?: string }>,
  ) => void;
  "auction:bet": (
    p: { questionId: string; option: string; tokens: number },
    cb: Ack<{ accepted: boolean; reason?: string }>,
  ) => void;
  // Mime D3 : le Donneur envoie un emoji de sa main (cooldown serveur §8.3).
  "mime:sendEmoji": (
    p: { questionId: string; emoji: string },
    cb: Ack<{ accepted: boolean; reason?: string }>,
  ) => void;
}

// ---------------------------------------------------------------------------
// Serveur → Client
// ---------------------------------------------------------------------------
export interface ServerToClient {
  "room:state": (snapshot: RoomSnapshot) => void;
  "pairing:names": (p: { coupleId: string; names: string[] }) => void;

  "round:intro": (p: { round: number; mode: GameMode; rule: string; isFinale: boolean; executeAt: number }) => void;
  "round:play": (p: PlayPayload) => void;
  "answer:ack": (p: { questionId: string; recorded: boolean }) => void; // feedback privé §5.2
  // Mime D3 : un emoji a été émis par le Donneur (broadcast à toute la room).
  "mime:emoji": (p: { questionId: string; emoji: string; index: number }) => void;
  "round:reveal": (p: RevealPayload) => void;

  "leaderboard:update": (p: { entries: LeaderboardEntry[]; rowPauseMs: number; topReserved: boolean }) => void;
  "score:update": (p: { coupleId: string; totalScore: number }) => void;

  "fx": (p: FxEvent) => void;
  "results:final": (p: { results: CoupleResult[] }) => void;

  "error": (p: { code: string; message: string }) => void;
}

/** Données questionnaire côté host (pour debug/affichage), jamais la réponse. */
export type { Question };
