import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomInt } from "node:crypto";
import type { GameMode, Intensity, Question } from "@couplewar/shared";

const INTENSITY_RANK: Record<Intensity, number> = { light: 0, medium: 1, deep: 2 };

/**
 * Banque de questions chargée depuis content/. Le moteur pioche par mode en
 * respectant l'intensité max du round et le quota global `deep ≤ N` (§2/§13).
 */
export class QuestionBank {
  private byMode = new Map<GameMode, Question[]>();

  load(contentDir: string): void {
    const files: Array<[GameMode, string]> = [
      ["sync", "questions.sync.json"],
      ["auction", "questions.auction.json"],
      ["wavelength", "questions.wavelength.json"],
      ["mime_d3", "questions.mime_d3.json"],
    ];
    for (const [mode, file] of files) {
      const path = resolve(contentDir, file);
      if (!existsSync(path)) continue; // mode optionnel (contenu pas encore fourni)
      const raw = readFileSync(path, "utf8");
      const questions = JSON.parse(raw) as Question[];
      this.byMode.set(mode, questions);
    }
  }

  /**
   * Pioche une question d'un mode. `intensityMax` borne l'intensité. `deepBudget`
   * = nombre de questions deep encore autorisées sur la partie ; si 0, on exclut
   * les deep même si intensityMax l'autorise. `usedIds` évite les répétitions.
   */
  pick(
    mode: GameMode,
    intensityMax: Intensity,
    deepBudget: number,
    usedIds: Set<string>,
  ): Question | null {
    const pool = this.byMode.get(mode) ?? [];
    const maxRank = INTENSITY_RANK[intensityMax];
    const eligible = pool.filter((q) => {
      if (usedIds.has(q.id)) return false;
      const rank = INTENSITY_RANK[q.intensity];
      if (rank > maxRank) return false;
      if (q.intensity === "deep" && deepBudget <= 0) return false;
      return true;
    });
    // Si rien d'éligible (banque épuisée), on autorise la répétition en relâchant usedIds.
    const finalPool =
      eligible.length > 0
        ? eligible
        : pool.filter((q) => {
            const rank = INTENSITY_RANK[q.intensity];
            if (rank > maxRank) return false;
            if (q.intensity === "deep" && deepBudget <= 0) return false;
            return true;
          });
    if (finalPool.length === 0) return null;
    return finalPool[randomInt(finalPool.length)];
  }
}
