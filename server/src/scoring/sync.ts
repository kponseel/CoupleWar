import type { GameConfig } from "@couplewar/shared";

/** Réponse d'un joueur pour une question Sync (responseTime null = pas/trop tard). */
export interface SyncPlayerAnswer {
  answer: string | null;
  responseTime: number | null; // ms depuis serverStartTime
}

export interface SyncCoupleInput {
  coupleId: string;
  a: SyncPlayerAnswer;
  b: SyncPlayerAnswer;
  /** Multiplicateur streak hérité du round Sync précédent (§5.3 étape 4). */
  streakMultiplierActive: boolean;
  /** Multiplicateur de finale éventuel (§2). */
  finaleMultiplier: number;
}

export interface SyncCoupleResult {
  coupleId: string;
  baseA: number;
  baseB: number;
  match: boolean;
  bothAnswered: boolean;
  latencyGap: number | null;
  heartbeat: boolean;
  deltaScore: number;
}

/** Points de base par joueur (§5.3 étape 1), bornés [baseMin, baseMax]. */
export function computeSyncBase(responseTime: number | null, cfg: GameConfig["sync"]): number {
  if (responseTime === null) return 0;
  const raw = Math.round((1 - responseTime / cfg.deadlineMs / 2) * 1000);
  return Math.max(cfg.baseMin, Math.min(cfg.baseMax, raw));
}

/** Scoring d'un couple pour une question Sync (§5.3, étapes 1→3). */
export function scoreSyncCouple(input: SyncCoupleInput, cfg: GameConfig["sync"]): SyncCoupleResult {
  const baseA = computeSyncBase(input.a.responseTime, cfg);
  const baseB = computeSyncBase(input.b.responseTime, cfg);
  const bothAnswered = input.a.answer !== null && input.b.answer !== null;
  const match = bothAnswered && input.a.answer === input.b.answer;

  const coupleBase = baseA + baseB;
  let score = match ? coupleBase * cfg.matchMultiplier : coupleBase;

  if (input.streakMultiplierActive) {
    score *= cfg.streakMultiplier;
  }

  const latencyGap =
    bothAnswered && input.a.responseTime !== null && input.b.responseTime !== null
      ? Math.abs(input.a.responseTime - input.b.responseTime)
      : null;

  const heartbeat = match && latencyGap !== null && latencyGap < cfg.heartbeatGapMs;
  if (heartbeat) {
    score += cfg.heartbeatBonus;
  }

  score *= input.finaleMultiplier;

  return {
    coupleId: input.coupleId,
    baseA,
    baseB,
    match,
    bothAnswered,
    latencyGap,
    heartbeat,
    deltaScore: Math.round(score),
  };
}
