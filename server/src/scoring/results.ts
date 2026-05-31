import { randomInt } from "node:crypto";
import type { CoupleResult, CoupleView, GameConfig } from "@couplewar/shared";
import type { ResultsContent } from "../content/results.js";

const NO_LATENCY = 99999; // valeur "pire" quand aucun latencyGap mesuré
const NO_WAVELENGTH = 100; // distance max quand aucune donnée wavelength

export interface ComputedStats {
  coupleId: string;
  syncRate: number;
  predictionRate: number;
  predictionDailyRate: number;
  predictionFutureRate: number;
  predictionFutureTotal: number;
  latencyGapMedian: number;
  wavelengthAccuracy: number;
  emojiHits: number;
  divergenceScore: number;
  socialVotes: number;
  totalScore: number;
}

function median(arr: number[], fallback: number): number {
  if (arr.length === 0) return fallback;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(arr: number[], fallback: number): number {
  if (arr.length === 0) return fallback;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
const rate = (ok: number, total: number): number => (total > 0 ? ok / total : 0);

export function computeStats(couple: CoupleView): ComputedStats {
  const s = couple.stats;
  return {
    coupleId: couple.id,
    syncRate: rate(s.syncMatches, s.syncTotal),
    predictionRate: rate(s.predictionCorrect, s.predictionTotal),
    predictionDailyRate: rate(s.predictionDailyCorrect, s.predictionDailyTotal),
    predictionFutureRate: rate(s.predictionFutureCorrect, s.predictionFutureTotal),
    predictionFutureTotal: s.predictionFutureTotal,
    latencyGapMedian: median(s.latencyGaps, NO_LATENCY),
    wavelengthAccuracy: mean(s.wavelengthDistances, NO_WAVELENGTH),
    emojiHits: rate(s.emojiHits, s.emojiTotal),
    divergenceScore: rate(s.divergences, s.syncTotal),
    socialVotes: s.socialVotes,
    totalScore: couple.totalScore,
  };
}

/** Rang 1-based par score décroissant. */
function scoreRanks(stats: ComputedStats[]): Map<string, number> {
  const sorted = [...stats].sort((a, b) => b.totalScore - a.totalScore);
  const ranks = new Map<string, number>();
  sorted.forEach((s, i) => ranks.set(s.coupleId, i + 1));
  return ranks;
}

/** Titre principal (§9.2), évalué en ordre de priorité — premier match gagne. */
function assignTitle(
  s: ComputedStats,
  all: ComputedStats[],
  ranks: Map<string, number>,
): string {
  const n = all.length;
  const rank = ranks.get(s.coupleId)!;
  const top = (k: number) => rank <= k;
  // top 20% par faible wavelengthAccuracy
  const waveSorted = [...all].sort((a, b) => a.wavelengthAccuracy - b.wavelengthAccuracy);
  const waveTop20Ids = new Set(
    waveSorted.slice(0, Math.max(1, Math.ceil(0.2 * n))).map((x) => x.coupleId),
  );
  const maxSocial = Math.max(...all.map((x) => x.socialVotes));

  const hasWaveData = s.wavelengthAccuracy < NO_WAVELENGTH;
  const inWaveTop20 = waveTop20Ids.has(s.coupleId);

  if (s.syncRate > 0.75 && s.latencyGapMedian < 800) return "cosmic_twins";
  if (inWaveTop20 && s.emojiHits > 0.6 && hasWaveData) return "daily_telepaths";
  if (s.predictionRate > 0.7 && s.syncRate < 0.4) return "chief_profiler";
  // 4 living_room_spicy : nécessite mode pimenté actif (hors MVP) → non évalué
  if (s.divergenceScore > 0.5 && top(4)) return "magnetic_opposites";
  if (s.syncRate > 0.6 && s.latencyGapMedian > 1500 && s.latencyGapMedian < NO_LATENCY)
    return "synced_hearts";
  if (top(3) && s.predictionRate > 0.6 && s.syncRate >= 0.4 && s.syncRate <= 0.7)
    return "confident_costars";
  if (s.predictionDailyRate > 0.6 && s.predictionFutureRate < 0.4 && s.predictionFutureTotal > 0)
    return "roommate_couple";
  if (s.latencyGapMedian > 4000 && s.latencyGapMedian < NO_LATENCY && s.syncRate < 0.4 && s.divergenceScore < 0.4)
    return "pacific_roommates";
  if (s.socialVotes > 0 && s.socialVotes === maxSocial) return "aperitif_veterans";
  if (s.syncRate < 0.3 && s.predictionRate < 0.4) return "work_in_progress";
  return "schrodinger";
}

/**
 * Médailles secondaires (§9.3) : assignment glouton pour maximiser le nombre de
 * couples récompensés. 5 dimensions, on normalise chacune (1 = meilleur), puis on
 * affecte les meilleures paires (couple, médaille) sans réassigner.
 */
function assignMedals(all: ComputedStats[]): Map<string, string> {
  const dims: Array<{ key: string; value: (s: ComputedStats) => number; higherBetter: boolean }> = [
    { key: "sync", value: (s) => s.syncRate, higherBetter: true },
    { key: "latency", value: (s) => s.latencyGapMedian, higherBetter: false },
    { key: "prediction", value: (s) => s.predictionRate, higherBetter: true },
    { key: "wavelength", value: (s) => s.wavelengthAccuracy, higherBetter: false },
    { key: "social", value: (s) => s.socialVotes, higherBetter: true },
  ];

  // Normalisation 0..1 (1 = meilleur) par dimension.
  type Cand = { coupleId: string; medal: string; norm: number };
  const candidates: Cand[] = [];
  for (const dim of dims) {
    const vals = all.map(dim.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min;
    for (const s of all) {
      const v = dim.value(s);
      let norm: number;
      if (span === 0) norm = 0.5;
      else norm = dim.higherBetter ? (v - min) / span : (max - v) / span;
      candidates.push({ coupleId: s.coupleId, medal: dim.key, norm });
    }
  }

  candidates.sort((a, b) => b.norm - a.norm);
  const assigned = new Map<string, string>();
  const usedMedals = new Set<string>();
  for (const c of candidates) {
    if (assigned.has(c.coupleId)) continue;
    if (usedMedals.has(c.medal)) continue;
    assigned.set(c.coupleId, c.medal);
    usedMedals.add(c.medal);
    if (assigned.size === all.length || usedMedals.size === dims.length) break;
  }
  return assigned;
}

/** % de compatibilité (§9.4), plancher garanti. */
export function computeCompatibility(s: ComputedStats, cfg: GameConfig): number {
  const w = cfg.results.weights;
  const normWave = Math.max(0, Math.min(1, 1 - s.wavelengthAccuracy / 100));
  const raw =
    s.syncRate * w.sync +
    s.predictionRate * w.prediction +
    normWave * w.wavelength +
    (1 - s.divergenceScore) * w.divergence;
  const floor = cfg.results.compatFloor;
  const final = floor + raw * (100 - floor);
  return Math.round(Math.max(floor, Math.min(100, final)));
}

function pickMetaphor(pct: number, content: ResultsContent): string {
  const tier =
    content.metaphors.find((t) => pct >= t.min && pct <= t.max) ??
    content.metaphors[content.metaphors.length - 1];
  return tier.lines[randomInt(tier.lines.length)];
}

/** Calcule l'écran RESULTS complet (§9) pour tous les couples. */
export function computeResults(
  couples: CoupleView[],
  cfg: GameConfig,
  content: ResultsContent,
): CoupleResult[] {
  const stats = couples.map(computeStats);
  const ranks = scoreRanks(stats);
  const medals = assignMedals(stats);
  const statById = new Map(stats.map((s) => [s.coupleId, s]));

  return couples.map((couple) => {
    const s = statById.get(couple.id)!;
    const titleKey = assignTitle(s, stats, ranks);
    const titleDef = content.titles[titleKey] ?? content.titles.schrodinger;
    const medalKey = medals.get(couple.id) ?? null;
    const medalDef = medalKey ? content.medals[medalKey] : null;
    const compatibility = computeCompatibility(s, cfg);

    return {
      coupleId: couple.id,
      name: couple.name,
      totalScore: couple.totalScore,
      rank: ranks.get(couple.id)!,
      title: { key: titleKey, label: titleDef.label, emoji: titleDef.emoji, blurb: titleDef.blurb },
      medal: medalDef ? { key: medalKey!, label: medalDef.label, emoji: medalDef.emoji } : null,
      compatibility,
      metaphor: pickMetaphor(compatibility, content),
      computedStats: {
        syncRate: s.syncRate,
        predictionRate: s.predictionRate,
        latencyGapMedian: s.latencyGapMedian,
        wavelengthAccuracy: s.wavelengthAccuracy,
        emojiHits: s.emojiHits,
        divergenceScore: s.divergenceScore,
        socialVotes: s.socialVotes,
      },
    };
  });
}
