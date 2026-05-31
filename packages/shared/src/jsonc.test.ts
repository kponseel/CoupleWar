import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc } from "./jsonc.js";

test("jsonc : parse du JSON standard", () => {
  assert.deepEqual(parseJsonc('{"a":1,"b":[1,2,3]}'), { a: 1, b: [1, 2, 3] });
});

test("jsonc : retire les commentaires de ligne", () => {
  const src = `{
    "a": 1, // commentaire
    "b": 2  // autre
  }`;
  assert.deepEqual(parseJsonc(src), { a: 1, b: 2 });
});

test("jsonc : retire les blocs de commentaire", () => {
  const src = `{
    /* bloc
       multi-ligne */
    "a": 1
  }`;
  assert.deepEqual(parseJsonc(src), { a: 1 });
});

test("jsonc : ne touche pas aux // dans les chaînes", () => {
  const src = '{ "url": "http://example.com", "note": "a/*b*/c" }';
  assert.deepEqual(parseJsonc(src), { url: "http://example.com", note: "a/*b*/c" });
});

test("jsonc : tolère les virgules traînantes", () => {
  assert.deepEqual(parseJsonc('{ "a": 1, "b": 2, }'), { a: 1, b: 2 });
  assert.deepEqual(parseJsonc("[1, 2, 3, ]"), [1, 2, 3]);
});

test("jsonc : gère les caractères échappés dans les chaînes", () => {
  assert.deepEqual(parseJsonc('{ "q": "a \\"// pas un commentaire\\" b" }'), {
    q: 'a "// pas un commentaire" b',
  });
});
