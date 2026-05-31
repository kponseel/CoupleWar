import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenBucket } from "./rateLimit.js";

test("TokenBucket : autorise jusqu'à la capacité de rafale puis bloque", () => {
  const b = new TokenBucket({ burst: 5, refillPerSec: 1 });
  const t0 = 1_000_000;
  // 5 jetons disponibles d'emblée.
  for (let i = 0; i < 5; i++) assert.equal(b.take(t0), true);
  // Le 6e (même instant) est bloqué.
  assert.equal(b.take(t0), false);
});

test("TokenBucket : se recharge avec le temps", () => {
  const b = new TokenBucket({ burst: 2, refillPerSec: 10 });
  const t0 = 2_000_000;
  assert.equal(b.take(t0), true);
  assert.equal(b.take(t0), true);
  assert.equal(b.take(t0), false); // vide
  // 200 ms plus tard → 2 jetons régénérés (10/s).
  assert.equal(b.take(t0 + 200), true);
  assert.equal(b.take(t0 + 200), true);
  assert.equal(b.take(t0 + 200), false);
});

test("TokenBucket : ne dépasse jamais la capacité après une longue attente", () => {
  const b = new TokenBucket({ burst: 3, refillPerSec: 100 });
  const t0 = 3_000_000;
  // Très longue attente → plafonné à burst, pas plus.
  assert.equal(b.take(t0 + 10_000), true);
  assert.equal(b.take(t0 + 10_000), true);
  assert.equal(b.take(t0 + 10_000), true);
  assert.equal(b.take(t0 + 10_000), false);
});
