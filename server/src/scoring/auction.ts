import type { GameConfig } from "@couplewar/shared";

export interface AuctionBet {
  coupleId: string;
  option: string;
  tokens: number;
  /** true si la mise vient du Devineur (partenaire du Cible) — éligible au jackpot. */
  isDevineur: boolean;
}

export interface AuctionInput {
  targetCoupleId: string;
  correctAnswer: string;
  bets: AuctionBet[];
  finaleMultiplier: number;
}

export interface AuctionCoupleResult {
  coupleId: string;
  option: string;
  tokens: number;
  correct: boolean;
  isDevineur: boolean;
  perfectBonus: boolean;
  deltaScore: number;
}

/** Scoring du mode Enchères (§7.3). */
export function scoreAuction(input: AuctionInput, cfg: GameConfig["auction"]): AuctionCoupleResult[] {
  return input.bets.map((bet) => {
    const correct = bet.option === input.correctAnswer;
    let points = correct ? bet.tokens * cfg.tokenToPoints * cfg.winMultiplier : 0;

    const perfectBonus = bet.isDevineur && correct && bet.tokens >= cfg.maxBet;
    if (perfectBonus) {
      points += cfg.perfectGuessBonus;
    }

    return {
      coupleId: bet.coupleId,
      option: bet.option,
      tokens: bet.tokens,
      correct,
      isDevineur: bet.isDevineur,
      perfectBonus,
      deltaScore: Math.round(points * input.finaleMultiplier),
    };
  });
}
