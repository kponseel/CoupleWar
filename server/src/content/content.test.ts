import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QuestionBank } from "./questions.js";
import { loadNamePools, generateCoupleNames, sanitizeCoupleName } from "./coupleNames.js";
import { makeRoomCode, makeCoupleJoinCode } from "../util/ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(__dirname, "..", "..", "..", "content");

// --- QuestionBank : intensité + quota deep (§2/§13) ---

test("QuestionBank : intensityMax exclut les questions plus intenses", () => {
  const bank = new QuestionBank();
  bank.load(contentDir);
  const used = new Set<string>();
  // intensityMax = light → on ne doit JAMAIS recevoir medium/deep.
  for (let i = 0; i < 50; i++) {
    const q = bank.pick("sync", "light", 2, used);
    assert.ok(q, "doit trouver une question light");
    assert.equal(q!.intensity, "light");
  }
});

test("QuestionBank : deepBudget=0 exclut les questions deep même si intensityMax=deep", () => {
  const bank = new QuestionBank();
  bank.load(contentDir);
  const used = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const q = bank.pick("sync", "deep", 0, used);
    assert.ok(q);
    assert.notEqual(q!.intensity, "deep");
  }
});

test("QuestionBank : usedIds évite la répétition tant que le pool n'est pas épuisé", () => {
  const bank = new QuestionBank();
  bank.load(contentDir);
  const used = new Set<string>();
  const first = bank.pick("sync", "medium", 2, used);
  assert.ok(first);
  used.add(first!.id);
  const second = bank.pick("sync", "medium", 2, used);
  assert.ok(second);
  assert.notEqual(second!.id, first!.id);
});

test("QuestionBank : mode inconnu renvoie null", () => {
  const bank = new QuestionBank();
  bank.load(contentDir);
  assert.equal(bank.pick("wavelength", "light", 2, new Set()), null);
});

// --- Noms de couples (§4.3) ---

test("coupleNames : génère le nombre demandé, distincts, au bon format", () => {
  loadNamePools(contentDir);
  const names = generateCoupleNames(3);
  assert.equal(names.length, 3);
  assert.equal(new Set(names).size, 3);
  for (const n of names) assert.match(n, /^Les .+ .+$/);
});

test("coupleNames : sanitize borne la longueur et remplace les insultes", () => {
  loadNamePools(contentDir);
  const long = "x".repeat(100);
  assert.ok(sanitizeCoupleName(long).length <= 40);
  // une entrée vide est remplacée par un nom propre généré
  assert.match(sanitizeCoupleName("   "), /^Les .+/);
  // un mot de la blocklist (« con ») est remplacé (ne contient pas le mot brut seul)
  const cleaned = sanitizeCoupleName("con");
  assert.notEqual(cleaned, "con");
});

test("coupleNames : conserve un nom propre tel quel", () => {
  loadNamePools(contentDir);
  assert.equal(sanitizeCoupleName("Les Pizzas Magnétiques"), "Les Pizzas Magnétiques");
});

// --- Codes (§4.1 / §4.2) ---

test("makeRoomCode : longueur exacte, alphabet sans voyelles", () => {
  for (let i = 0; i < 100; i++) {
    const code = makeRoomCode(4);
    assert.equal(code.length, 4);
    assert.doesNotMatch(code, /[AEIOUY]/);
    assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]+$/);
  }
});

test("makeCoupleJoinCode : toujours 2 chiffres entre 10 et 99", () => {
  for (let i = 0; i < 200; i++) {
    const code = makeCoupleJoinCode();
    assert.match(code, /^\d{2}$/);
    const n = Number(code);
    assert.ok(n >= 10 && n <= 99);
  }
});
