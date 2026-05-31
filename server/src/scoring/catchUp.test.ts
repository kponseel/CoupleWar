import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCatchUp } from "./catchUp.js";

const cfg = { enabled: true, leaderPenalty: 0.8, lastBonus: 1.3, minCouples: 3 };

test("catchUp : pénalise le leader, booste le dernier, neutre au milieu", () => {
  const res = computeCatchUp(
    [
      { coupleId: "a", totalScore: 9000 }, // leader
      { coupleId: "b", totalScore: 5000 }, // milieu
      { coupleId: "c", totalScore: 1000 }, // dernier
    ],
    cfg,
  );
  const by = Object.fromEntries(res.map((r) => [r.coupleId, r]));
  assert.equal(by.a.multiplier, 0.8);
  assert.equal(by.a.kind, "handicap");
  assert.equal(by.b.multiplier, 1);
  assert.equal(by.b.kind, null);
  assert.equal(by.c.multiplier, 1.3);
  assert.equal(by.c.kind, "bonus");
});

test("catchUp : désactivé si enabled=false", () => {
  const res = computeCatchUp(
    [
      { coupleId: "a", totalScore: 9000 },
      { coupleId: "b", totalScore: 1000 },
      { coupleId: "c", totalScore: 500 },
    ],
    { ...cfg, enabled: false },
  );
  assert.ok(res.every((r) => r.multiplier === 1 && r.kind === null));
});

test("catchUp : désactivé sous le seuil minCouples", () => {
  const res = computeCatchUp(
    [
      { coupleId: "a", totalScore: 9000 },
      { coupleId: "b", totalScore: 1000 },
    ],
    cfg, // minCouples=3
  );
  assert.ok(res.every((r) => r.multiplier === 1));
});

test("catchUp : égalité parfaite → aucun handicap/bonus", () => {
  const res = computeCatchUp(
    [
      { coupleId: "a", totalScore: 100 },
      { coupleId: "b", totalScore: 100 },
      { coupleId: "c", totalScore: 100 },
    ],
    cfg,
  );
  assert.ok(res.every((r) => r.multiplier === 1 && r.kind === null));
});

test("catchUp : ex æquo en tête → pas de leader désigné, mais dernier boosté", () => {
  const res = computeCatchUp(
    [
      { coupleId: "a", totalScore: 9000 },
      { coupleId: "b", totalScore: 9000 }, // co-leaders
      { coupleId: "c", totalScore: 1000 },
    ],
    cfg,
  );
  const by = Object.fromEntries(res.map((r) => [r.coupleId, r]));
  assert.equal(by.a.kind, null);
  assert.equal(by.b.kind, null);
  assert.equal(by.c.kind, "bonus");
});
