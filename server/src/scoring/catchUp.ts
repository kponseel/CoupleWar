import type { GameConfig } from "@couplewar/shared";

/** Classement d'un couple à l'entrée d'un round (pour le handicap/bonus). */
export interface Standing {
  coupleId: string;
  totalScore: number;
}

/** Étiquette de handicap/bonus secret par couple (null = neutre). */
export type CatchUpKind = "handicap" | "bonus" | null;

export interface CatchUpAssignment {
  coupleId: string;
  /** Multiplicateur appliqué au score gagné CE round (1 = neutre). */
  multiplier: number;
  kind: CatchUpKind;
}

/**
 * Anti-décrochage « Mario Kart » (§10.3). À partir du classement courant :
 * - le couple EN TÊTE est pénalisé (multiplier = leaderPenalty),
 * - le couple DERNIER est boosté (multiplier = lastBonus),
 * - les autres sont neutres.
 *
 * Désactivé si `enabled=false`, si moins de `minCouples` couples, ou si tous les
 * couples sont à égalité (pas de leader/dernier distinct). Jamais en FINALE
 * (la Room ne l'appelle pas dans ce cas).
 */
export function computeCatchUp(
  standings: Standing[],
  cfg: GameConfig["catchUp"],
): CatchUpAssignment[] {
  const neutral = standings.map((s) => ({ coupleId: s.coupleId, multiplier: 1, kind: null as CatchUpKind }));
  if (!cfg.enabled || standings.length < cfg.minCouples) return neutral;

  const scores = standings.map((s) => s.totalScore);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  if (max === min) return neutral; // égalité parfaite → pas de catch-up

  // Un seul leader et un seul dernier (en cas d'ex æquo, on n'en désigne aucun
  // pour ce rang afin de ne pas pénaliser/avantager arbitrairement).
  const leaders = standings.filter((s) => s.totalScore === max);
  const lasts = standings.filter((s) => s.totalScore === min);
  const leaderId = leaders.length === 1 ? leaders[0].coupleId : null;
  const lastId = lasts.length === 1 ? lasts[0].coupleId : null;

  return standings.map((s) => {
    if (s.coupleId === leaderId) return { coupleId: s.coupleId, multiplier: cfg.leaderPenalty, kind: "handicap" as CatchUpKind };
    if (s.coupleId === lastId) return { coupleId: s.coupleId, multiplier: cfg.lastBonus, kind: "bonus" as CatchUpKind };
    return { coupleId: s.coupleId, multiplier: 1, kind: null as CatchUpKind };
  });
}
