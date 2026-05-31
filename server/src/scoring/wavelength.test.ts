import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc, gameConfigSchema } from "@couplewar/shared";
import { scoreWavelength, ringFor } from "./wavelength.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const config = gameConfigSchema.parse(
  parseJsonc(readFileSync(resolve(repoRoot, "config", "game.config.json"), "utf8")),
);
const cfg = config.wavelength;

test("wavelength : anneaux selon la distance", () => {
  assert.equal(ringFor(0, cfg), "bullseye");
  assert.equal(ringFor(cfg.bullseyeRadius, cfg), "bullseye");
  assert.equal(ringFor(cfg.bullseyeRadius + 0.1, cfg), "mid");
  assert.equal(ringFor(cfg.midRadius, cfg), "mid");
  assert.equal(ringFor(cfg.outerRadius, cfg), "outer");
  assert.equal(ringFor(cfg.outerRadius + 1, cfg), "miss");
});

test("wavelength : émetteur marque selon l'anneau touché par le récepteur", () => {
  const res = scoreWavelength(
    { target: 50, cursor: 50, bullseyeRadius: cfg.bullseyeRadius, midRadius: cfg.midRadius, outerRadius: cfg.outerRadius, bets: [], emitterCoupleId: "cA", finaleMultiplier: 1 },
    cfg,
  );
  assert.equal(res.ring, "bullseye");
  assert.equal(res.emitterPoints, cfg.bullseyePts);
  assert.equal(res.distance, 0);
});

test("wavelength : direction d'erreur correcte (curseur à gauche → 'right')", () => {
  const res = scoreWavelength(
    { target: 70, cursor: 40, bullseyeRadius: cfg.bullseyeRadius, midRadius: cfg.midRadius, outerRadius: cfg.outerRadius, bets: [{ coupleId: "cB", direction: "right" }], emitterCoupleId: "cA", finaleMultiplier: 1 },
    cfg,
  );
  assert.equal(res.actualDirection, "right");
  assert.equal(res.betPoints.get("cB"), cfg.betCorrectPts);
});

test("wavelength : pari 'dans le mille' ne paie que si le récepteur a tapé le centre", () => {
  // Centre touché → seul "bullseye" marque (gros).
  const hit = scoreWavelength(
    { target: 50, cursor: 51, bullseyeRadius: cfg.bullseyeRadius, midRadius: cfg.midRadius, outerRadius: cfg.outerRadius, bets: [{ coupleId: "cB", direction: "bullseye" }, { coupleId: "cC", direction: "left" }], emitterCoupleId: "cA", finaleMultiplier: 1 },
    cfg,
  );
  assert.equal(hit.actualDirection, "bullseye");
  assert.equal(hit.betPoints.get("cB"), cfg.betBullseyePts);
  assert.equal(hit.betPoints.get("cC"), 0);
});

test("wavelength : l'émetteur ne parie pas (ignoré)", () => {
  const res = scoreWavelength(
    { target: 30, cursor: 80, bullseyeRadius: cfg.bullseyeRadius, midRadius: cfg.midRadius, outerRadius: cfg.outerRadius, bets: [{ coupleId: "cA", direction: "left" }], emitterCoupleId: "cA", finaleMultiplier: 1 },
    cfg,
  );
  assert.equal(res.betPoints.has("cA"), false);
});

test("wavelength : multiplicateur de finale appliqué", () => {
  const res = scoreWavelength(
    { target: 50, cursor: 50, bullseyeRadius: cfg.bullseyeRadius, midRadius: cfg.midRadius, outerRadius: cfg.outerRadius, bets: [], emitterCoupleId: "cA", finaleMultiplier: config.finale.scoreMultiplier },
    cfg,
  );
  assert.equal(res.emitterPoints, Math.round(cfg.bullseyePts * config.finale.scoreMultiplier));
});
