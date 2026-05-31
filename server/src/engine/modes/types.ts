import type {
  FxEvent,
  GameConfig,
  GameMode,
  Question,
  RevealPayload,
  ServerToClient,
} from "@couplewar/shared";
import type { Clock } from "../clock.js";
import type { Couple, Player } from "../../rooms/model.js";

/** Émetteur typé d'événements serveur → client. */
export type Emit = <K extends keyof ServerToClient>(
  ev: K,
  ...args: Parameters<ServerToClient[K]>
) => void;

/** Contexte fourni à chaque contrôleur de round par la Room. */
export interface RoundContext {
  config: GameConfig;
  question: Question;
  isFinale: boolean;
  finaleMultiplier: number;
  clock: Clock;
  /** Couples internes (mutables : le scoring écrit ici). */
  couples: Couple[];
  playersById: Map<string, Player>;
  /** Index 0-based du round PARMI les rounds du même mode (rotation des rôles). */
  modeRoundIndex: number;

  broadcast: Emit;
  emitToPlayer: (playerId: string, ...args: Parameters<Emit>) => void;
  emitToCouple: (coupleId: string, ...args: Parameters<Emit>) => void;

  /** Le contrôleur signale que la phase de jeu est terminée → la Room enchaîne. */
  requestComplete: () => void;
}

/**
 * Plugin de mode (§13). Implémente le contrat
 * { startPlay, collectAnswers, computeScore, buildReveal } décliné ici.
 * La Room pilote la state-machine ; le contrôleur gère sa logique + ses timers.
 */
export interface RoundController {
  readonly mode: GameMode;
  readonly rule: string;
  /** Durée de sécurité max de la phase de jeu (la Room coupe au-delà). */
  readonly maxDurationMs: number;

  /** ROUND_PLAY commence : émet les payloads, arme les timers internes. */
  startPlay(): void;
  /** collectAnswers : traite une réponse entrante. */
  collectAnswer(
    playerId: string,
    payload: { questionId: string; answer: string; clientSubmitTime: number },
  ): { accepted: boolean; reason?: string };
  /** Mode Enchères : traite une mise. */
  collectBet?(
    playerId: string,
    payload: { questionId: string; option: string; tokens: number },
  ): { accepted: boolean; reason?: string };
  /** computeScore + buildReveal : finalise, mute les couples, renvoie le reveal + FX. */
  finishAndReveal(executeAt: number): { reveal: RevealPayload; fx: FxEvent[] };
  /** Payload de jeu courant, pour re-synchroniser un joueur qui se reconnecte (§14). */
  resync(): import("@couplewar/shared").PlayPayload | null;
  /** Nettoie les timers internes. */
  dispose(): void;
}

export type ModeFactory = (ctx: RoundContext) => RoundController;
