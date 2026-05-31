import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyMatch, normalizeText, levenshtein } from "./fuzzy.js";

test("normalizeText : minuscule, sans accents ni ponctuation", () => {
  assert.equal(normalizeText("Notre Dimanche idéal !"), "notre dimanche ideal");
  assert.equal(normalizeText("  ÉTÉ, à la PLAGE  "), "ete a la plage");
});

test("levenshtein : distances connues", () => {
  assert.equal(levenshtein("chat", "chat"), 0);
  assert.equal(levenshtein("chat", "chats"), 1);
  assert.equal(levenshtein("dimanche", "dimance"), 1);
});

test("fuzzy : correspondance exacte (accents/casse/ponctuation ignorés)", () => {
  assert.equal(fuzzyMatch("dimanche idéal", "Dimanche idéal"), true);
  assert.equal(fuzzyMatch("LA PLAGE !!!", "la plage"), true);
});

test("fuzzy : tolère une petite faute de frappe", () => {
  assert.equal(fuzzyMatch("dimance idéal", "dimanche idéal"), true); // 1 faute
  assert.equal(fuzzyMatch("vacance a la mer", "vacances à la mer"), true);
});

test("fuzzy : recouvrement partiel des mots significatifs (≥60%)", () => {
  // 2 mots significatifs sur 2 retrouvés malgré l'ordre/les mots vides.
  assert.equal(fuzzyMatch("un dimanche à la plage", "dimanche plage"), true);
});

test("fuzzy : rejette une réponse sans rapport", () => {
  assert.equal(fuzzyMatch("pizza", "dimanche idéal"), false);
  assert.equal(fuzzyMatch("", "dimanche idéal"), false);
  assert.equal(fuzzyMatch("   ", "dimanche idéal"), false);
});

test("fuzzy : variantes acceptées explicitement", () => {
  assert.equal(fuzzyMatch("ciné", "soirée cinéma", ["ciné", "film"]), true);
  assert.equal(fuzzyMatch("film", "soirée cinéma", ["ciné", "film"]), true);
});

test("fuzzy : mots courts exigent l'exactitude (pas de faux positif)", () => {
  assert.equal(fuzzyMatch("chien", "chat"), false); // pas proche malgré 4-5 lettres
});
