import type { GameConfig } from "@couplewar/shared";

/** Une bonne réponse enregistrée pendant la manche emoji. */
export interface MimeHit {
  coupleId: string;
  /** true si c'est le couple actif (Donneur+Récepteur). */
  isActiveCouple: boolean;
  /** Ordre d'arrivée de la bonne réponse (0 = premier). */
  order: number;
}

export interface MimeInput {
  activeCoupleId: string;
  hits: MimeHit[];
  finaleMultiplier: number;
}

export interface MimeCoupleResult {
  coupleId: string;
  correct: boolean;
  deltaScore: number;
  /** true si le couple actif (Récepteur) a trouvé. */
  transmitted: boolean;
}

/**
 * Scoring du mode Mime D3 (§8.3).
 * - Le couple actif marque `matchPts` si le Récepteur a deviné le concept.
 * - Chaos bonus : un AUTRE couple qui devine AVANT le Récepteur marque
 *   `otherCoupleGuessPts`. (S'il devine après, pas de bonus — l'idée a déjà
 *   « circulé ».)
 */
export function scoreMime(input: MimeInput, cfg: GameConfig["mime"]): MimeCoupleResult[] {
  const active = input.hits.find((h) => h.isActiveCouple);
  const receiverOrder = active ? active.order : Infinity;

  const byCouple = new Map<string, MimeCoupleResult>();
  for (const hit of input.hits) {
    if (byCouple.has(hit.coupleId)) continue; // 1re bonne réponse du couple compte
    if (hit.isActiveCouple) {
      byCouple.set(hit.coupleId, {
        coupleId: hit.coupleId,
        correct: true,
        transmitted: true,
        deltaScore: Math.round(cfg.matchPts * input.finaleMultiplier),
      });
    } else {
      const beforeReceiver = hit.order < receiverOrder;
      byCouple.set(hit.coupleId, {
        coupleId: hit.coupleId,
        correct: true,
        transmitted: false,
        deltaScore: beforeReceiver ? Math.round(cfg.otherCoupleGuessPts * input.finaleMultiplier) : 0,
      });
    }
  }
  return [...byCouple.values()];
}
