import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc, gameConfigSchema, type CoupleView } from "@couplewar/shared";
import { computeSyncBase, scoreSyncCouple } from "./sync.js";
import { scoreAuction } from "./auction.js";
import { computeResults, computeCompatibility, computeStats } from "./results.js";
import { loadResultsContent, getResultsContent } from "../content/results.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const config = gameConfigSchema.parse(
  parseJsonc(readFileSync(resolve(repoRoot, "config", "game.config.json"), "utf8")),
);

loadResultsContent(resolve(repoRoot, "content"));
const resultsContent = getResultsContent();

test("sync base est borné [baseMin, baseMax] dans les temps, 0 hors temps", () => {
  assert.equal(computeSyncBase(0, config.sync), config.sync.baseMax); // instantané → max
  assert.equal(computeSyncBase(config.sync.deadlineMs, config.sync), config.sync.baseMin); // limite → min
  assert.equal(computeSyncBase(null, config.sync), 0); // pas de réponse → 0
});

test("sync : match applique le multiplicateur et le bonus Cœur Battant", () => {
  const res = scoreSyncCouple(
    {
      coupleId: "c1",
      a: { answer: "X", responseTime: 1000 },
      b: { answer: "X", responseTime: 1200 }, // gap 200ms < 500 → heartbeat
      streakMultiplierActive: false,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  assert.equal(res.match, true);
  assert.equal(res.heartbeat, true);
  assert.equal(res.latencyGap, 200);
  const baseA = computeSyncBase(1000, config.sync);
  const baseB = computeSyncBase(1200, config.sync);
  const expected = Math.round((baseA + baseB) * config.sync.matchMultiplier + config.sync.heartbeatBonus);
  assert.equal(res.deltaScore, expected);
});

test("sync : pas de match → pas de bonus, pas de pénalité", () => {
  const res = scoreSyncCouple(
    {
      coupleId: "c1",
      a: { answer: "X", responseTime: 1000 },
      b: { answer: "Y", responseTime: 1200 },
      streakMultiplierActive: false,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  assert.equal(res.match, false);
  assert.equal(res.heartbeat, false);
  const expected = computeSyncBase(1000, config.sync) + computeSyncBase(1200, config.sync);
  assert.equal(res.deltaScore, expected);
});

test("sync : un partenaire absent → pas de crash, pas de match", () => {
  const res = scoreSyncCouple(
    {
      coupleId: "c1",
      a: { answer: "X", responseTime: 1000 },
      b: { answer: null, responseTime: null },
      streakMultiplierActive: false,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  assert.equal(res.match, false);
  assert.equal(res.bothAnswered, false);
  assert.equal(res.latencyGap, null);
  assert.equal(res.deltaScore, computeSyncBase(1000, config.sync));
});

test("auction : mise gagnante x winMultiplier, jackpot Devineur sur mise max", () => {
  const results = scoreAuction(
    {
      targetCoupleId: "cT",
      correctAnswer: "Pizza",
      bets: [
        { coupleId: "cT", option: "Pizza", tokens: config.auction.maxBet, isDevineur: true },
        { coupleId: "c2", option: "Pizza", tokens: 2, isDevineur: false },
        { coupleId: "c3", option: "Sushi", tokens: 3, isDevineur: false },
      ],
      finaleMultiplier: 1,
    },
    config.auction,
  );
  const devineur = results.find((r) => r.coupleId === "cT")!;
  const winner = results.find((r) => r.coupleId === "c2")!;
  const loser = results.find((r) => r.coupleId === "c3")!;
  assert.equal(devineur.perfectBonus, true);
  assert.equal(
    devineur.deltaScore,
    config.auction.maxBet * config.auction.tokenToPoints * config.auction.winMultiplier +
      config.auction.perfectGuessBonus,
  );
  assert.equal(winner.deltaScore, 2 * config.auction.tokenToPoints * config.auction.winMultiplier);
  assert.equal(loser.deltaScore, 0);
});

function makeCouple(id: string, over: Partial<CoupleView["stats"]>, score: number): CoupleView {
  return {
    id,
    name: `Couple ${id}`,
    players: [`${id}_a`, `${id}_b`],
    totalScore: score,
    streak: 0,
    handicap: null,
    stats: {
      syncMatches: 0,
      syncTotal: 0,
      latencyGaps: [],
      predictionCorrect: 0,
      predictionTotal: 0,
      predictionDailyCorrect: 0,
      predictionDailyTotal: 0,
      predictionFutureCorrect: 0,
      predictionFutureTotal: 0,
      wavelengthDistances: [],
      emojiHits: 0,
      emojiTotal: 0,
      divergences: 0,
      socialVotes: 0,
      ...over,
    },
  };
}

test("% de compatibilité n'est jamais sous le plancher", () => {
  const empty = makeCouple("c0", {}, 0);
  const stats = computeStats(empty);
  assert.ok(computeCompatibility(stats, config) >= config.results.compatFloor);
});

test("results : chaque couple a un titre, médailles sans trou pour ≤5 couples", () => {
  const couples = [
    makeCouple("c1", { syncMatches: 8, syncTotal: 8, latencyGaps: [300, 400] }, 9000),
    makeCouple("c2", { predictionCorrect: 5, predictionTotal: 5 }, 7000),
    makeCouple("c3", { socialVotes: 9 }, 5000),
    makeCouple("c4", { divergences: 6, syncTotal: 8 }, 3000),
  ];
  const results = computeResults(couples, config, resultsContent);
  assert.equal(results.length, 4);
  for (const r of results) {
    assert.ok(r.title.label.length > 0); // titre garanti
    assert.ok(r.compatibility >= config.results.compatFloor);
  }
  // ≤5 couples → tous reçoivent une médaille (assignment glouton sans trou).
  assert.ok(results.every((r) => r.medal !== null));
});
