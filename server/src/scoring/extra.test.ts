import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc, gameConfigSchema } from "@couplewar/shared";
import { scoreSyncCouple } from "./sync.js";
import { scoreAuction } from "./auction.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const config = gameConfigSchema.parse(
  parseJsonc(readFileSync(resolve(repoRoot, "config", "game.config.json"), "utf8")),
);

// --- Sync : streak + finale (§5.3 étape 4 / §2) ---

test("sync : le multiplicateur de streak s'applique au couple", () => {
  const base = scoreSyncCouple(
    {
      coupleId: "c",
      a: { answer: "X", responseTime: 1000 },
      b: { answer: "X", responseTime: 1000 },
      streakMultiplierActive: false,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  const boosted = scoreSyncCouple(
    {
      coupleId: "c",
      a: { answer: "X", responseTime: 1000 },
      b: { answer: "X", responseTime: 1000 },
      streakMultiplierActive: true,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  // Le bonus Cœur Battant (gap 0) est additif APRÈS le streak ; on vérifie que
  // le score boosté est strictement supérieur et cohérent avec streakMultiplier.
  assert.ok(boosted.deltaScore > base.deltaScore);
});

test("sync : le multiplicateur de finale multiplie le score final", () => {
  const normal = scoreSyncCouple(
    {
      coupleId: "c",
      a: { answer: "X", responseTime: 2000 },
      b: { answer: "X", responseTime: 2000 },
      streakMultiplierActive: false,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  const finale = scoreSyncCouple(
    {
      coupleId: "c",
      a: { answer: "X", responseTime: 2000 },
      b: { answer: "X", responseTime: 2000 },
      streakMultiplierActive: false,
      finaleMultiplier: config.finale.scoreMultiplier,
    },
    config.sync,
  );
  assert.equal(finale.deltaScore, Math.round(normal.deltaScore * config.finale.scoreMultiplier));
});

test("sync : aucune réponse des deux → 0 point, latencyGap null, pas de crash", () => {
  const res = scoreSyncCouple(
    {
      coupleId: "c",
      a: { answer: null, responseTime: null },
      b: { answer: null, responseTime: null },
      streakMultiplierActive: false,
      finaleMultiplier: 1,
    },
    config.sync,
  );
  assert.equal(res.deltaScore, 0);
  assert.equal(res.match, false);
  assert.equal(res.bothAnswered, false);
  assert.equal(res.latencyGap, null);
});

// --- Enchères : cas limites (§7.3) ---

test("auction : sans aucune mise → tableau vide, aucun crash", () => {
  const res = scoreAuction(
    { targetCoupleId: "cT", correctAnswer: "Pizza", bets: [], finaleMultiplier: 1 },
    config.auction,
  );
  assert.deepEqual(res, []);
});

test("auction : mise gagnante sur réponse libre (hors options de base)", () => {
  const res = scoreAuction(
    {
      targetCoupleId: "cT",
      correctAnswer: "réponse tapée à la main",
      bets: [{ coupleId: "c2", option: "réponse tapée à la main", tokens: 3, isDevineur: false }],
      finaleMultiplier: 1,
    },
    config.auction,
  );
  assert.equal(res[0].correct, true);
  assert.equal(res[0].deltaScore, 3 * config.auction.tokenToPoints * config.auction.winMultiplier);
});

test("auction : un non-Devineur avec mise max ne déclenche PAS le jackpot", () => {
  const res = scoreAuction(
    {
      targetCoupleId: "cT",
      correctAnswer: "Pizza",
      bets: [{ coupleId: "c2", option: "Pizza", tokens: config.auction.maxBet, isDevineur: false }],
      finaleMultiplier: 1,
    },
    config.auction,
  );
  assert.equal(res[0].perfectBonus, false);
  assert.equal(
    res[0].deltaScore,
    config.auction.maxBet * config.auction.tokenToPoints * config.auction.winMultiplier,
  );
});

test("auction : le multiplicateur de finale s'applique aussi aux gains", () => {
  const res = scoreAuction(
    {
      targetCoupleId: "cT",
      correctAnswer: "Pizza",
      bets: [{ coupleId: "c2", option: "Pizza", tokens: 2, isDevineur: false }],
      finaleMultiplier: config.finale.scoreMultiplier,
    },
    config.auction,
  );
  const expected = Math.round(
    2 * config.auction.tokenToPoints * config.auction.winMultiplier * config.finale.scoreMultiplier,
  );
  assert.equal(res[0].deltaScore, expected);
});
