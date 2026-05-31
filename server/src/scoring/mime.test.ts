import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc, gameConfigSchema } from "@couplewar/shared";
import { scoreMime } from "./mime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const config = gameConfigSchema.parse(
  parseJsonc(readFileSync(resolve(repoRoot, "config", "game.config.json"), "utf8")),
);
const cfg = config.mime;

test("mime : le couple actif marque matchPts si le Récepteur trouve", () => {
  const res = scoreMime(
    { activeCoupleId: "cA", hits: [{ coupleId: "cA", isActiveCouple: true, order: 0 }], finaleMultiplier: 1 },
    cfg,
  );
  const a = res.find((r) => r.coupleId === "cA")!;
  assert.equal(a.transmitted, true);
  assert.equal(a.deltaScore, cfg.matchPts);
});

test("mime : chaos bonus pour un autre couple qui devine AVANT le Récepteur", () => {
  const res = scoreMime(
    {
      activeCoupleId: "cA",
      hits: [
        { coupleId: "cB", isActiveCouple: false, order: 0 }, // devine en 1er
        { coupleId: "cA", isActiveCouple: true, order: 1 }, // Récepteur ensuite
      ],
      finaleMultiplier: 1,
    },
    cfg,
  );
  assert.equal(res.find((r) => r.coupleId === "cB")!.deltaScore, cfg.otherCoupleGuessPts);
  assert.equal(res.find((r) => r.coupleId === "cA")!.deltaScore, cfg.matchPts);
});

test("mime : pas de bonus si l'autre couple devine APRÈS le Récepteur", () => {
  const res = scoreMime(
    {
      activeCoupleId: "cA",
      hits: [
        { coupleId: "cA", isActiveCouple: true, order: 0 },
        { coupleId: "cB", isActiveCouple: false, order: 1 },
      ],
      finaleMultiplier: 1,
    },
    cfg,
  );
  assert.equal(res.find((r) => r.coupleId === "cB")!.deltaScore, 0);
});

test("mime : aucune bonne réponse → tableau vide", () => {
  const res = scoreMime({ activeCoupleId: "cA", hits: [], finaleMultiplier: 1 }, cfg);
  assert.deepEqual(res, []);
});

test("mime : multiplicateur de finale appliqué", () => {
  const res = scoreMime(
    { activeCoupleId: "cA", hits: [{ coupleId: "cA", isActiveCouple: true, order: 0 }], finaleMultiplier: config.finale.scoreMultiplier },
    cfg,
  );
  assert.equal(res[0].deltaScore, Math.round(cfg.matchPts * config.finale.scoreMultiplier));
});
