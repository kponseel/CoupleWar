import type { GameConfig } from "@couplewar/shared";

/**
 * Scoring du mode Wavelength (§6.4).
 *
 * - Le couple émetteur marque selon l'anneau touché par le curseur du Récepteur
 *   (centre / moyen / large / hors-cible).
 * - Chaque couple parieur marque s'il a deviné la bonne DIRECTION de l'erreur,
 *   ou la cible exacte (« dans le mille »).
 */
export type BetDirection = "left" | "bullseye" | "right";

export interface WavelengthInput {
  /** Position de la cible 0..100 (centre du bullseye). */
  target: number;
  /** Position validée par le Récepteur 0..100. */
  cursor: number;
  /** Demi-largeurs des anneaux (en unités 0..100) autour de la cible. */
  bullseyeRadius: number;
  midRadius: number;
  outerRadius: number;
  /** Paris des autres couples (coupleId → direction). */
  bets: Array<{ coupleId: string; direction: BetDirection }>;
  emitterCoupleId: string;
  finaleMultiplier: number;
}

export interface WavelengthResult {
  /** Anneau atteint par le Récepteur. */
  ring: "bullseye" | "mid" | "outer" | "miss";
  /** Distance |cursor - target|. */
  distance: number;
  /** Points du couple émetteur (avant finale). */
  emitterPoints: number;
  /** Résolution des paris : coupleId → points gagnés. */
  betPoints: Map<string, number>;
  /** Direction réelle de l'erreur du Récepteur, du point de vue parieur. */
  actualDirection: BetDirection;
}

/** Anneau touché selon la distance au centre. */
export function ringFor(
  distance: number,
  cfg: Pick<GameConfig["wavelength"], "bullseyeRadius" | "midRadius" | "outerRadius">,
): WavelengthResult["ring"] {
  if (distance <= cfg.bullseyeRadius) return "bullseye";
  if (distance <= cfg.midRadius) return "mid";
  if (distance <= cfg.outerRadius) return "outer";
  return "miss";
}

export function scoreWavelength(input: WavelengthInput, cfg: GameConfig["wavelength"]): WavelengthResult {
  const distance = Math.abs(input.cursor - input.target);
  const ring = ringFor(distance, input);

  const ringPts =
    ring === "bullseye" ? cfg.bullseyePts : ring === "mid" ? cfg.midPts : ring === "outer" ? cfg.outerPts : 0;
  const emitterPoints = Math.round(ringPts * input.finaleMultiplier);

  // Direction réelle de l'erreur : si le curseur est à GAUCHE de la cible, il
  // aurait fallu aller « plus à droite » → la bonne prédiction est "right", etc.
  // En plein dans le mille → "bullseye".
  const actualDirection: BetDirection =
    ring === "bullseye" ? "bullseye" : input.cursor < input.target ? "right" : "left";

  const betPoints = new Map<string, number>();
  for (const bet of input.bets) {
    if (bet.coupleId === input.emitterCoupleId) continue; // l'émetteur ne parie pas
    let pts = 0;
    if (actualDirection === "bullseye") {
      // Le Récepteur a tapé le centre : seuls les "bullseye" marquent (gros).
      if (bet.direction === "bullseye") pts = cfg.betBullseyePts;
    } else if (bet.direction === actualDirection) {
      pts = cfg.betCorrectPts;
    }
    betPoints.set(bet.coupleId, Math.round(pts * input.finaleMultiplier));
  }

  return { ring, distance, emitterPoints, betPoints, actualDirection };
}
