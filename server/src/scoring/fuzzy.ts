/**
 * Correspondance approximative (fuzzy) entre une réponse libre du joueur et un
 * concept secret (mode Mime, §8.3). Tolérante aux accents, à la casse, à la
 * ponctuation et aux petites fautes, mais sans être laxiste au point d'accepter
 * n'importe quoi. Pure et déterministe → testable.
 */

/** Minuscule, sans accents/diacritiques, sans ponctuation, espaces normalisés. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // ponctuation → espace
    .replace(/\s+/g, " ")
    .trim();
}

/** Mots « vides » ignorés dans la comparaison de tokens. */
const STOP_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "d", "l", "et", "a", "au",
  "aux", "en", "ce", "cet", "cette", "mon", "ma", "mes", "ton", "ta", "tes",
  "notre", "nos", "votre", "vos", "the", "of", "to",
]);

function tokens(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/** Distance de Levenshtein (itérative, O(n·m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Deux mots sont « proches » si Levenshtein ≤ seuil dépendant de la longueur. */
function wordClose(a: string, b: string): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen <= 3) return a === b; // mots courts : exact
  const tol = maxLen <= 6 ? 1 : 2;
  return levenshtein(a, b) <= tol;
}

/**
 * Vrai si `guess` correspond au `secret` (ou à une variante de `accept`).
 * Stratégie : normalisation exacte, sinon recouvrement de tokens significatifs
 * (≥ 60 % des tokens cible retrouvés, à une petite faute près).
 */
export function fuzzyMatch(guess: string, secret: string, accept: string[] = []): boolean {
  if (!guess || !guess.trim()) return false;
  const targets = [secret, ...accept];
  const gNorm = normalizeText(guess);

  for (const target of targets) {
    const tNorm = normalizeText(target);
    if (!tNorm) continue;
    if (gNorm === tNorm) return true;
    // Inclusion directe pour les cibles courtes (1-2 mots).
    const tTokens = tokens(target);
    if (tTokens.length <= 2 && gNorm.includes(tNorm)) return true;

    const gTokens = tokens(guess);
    if (tTokens.length === 0 || gTokens.length === 0) continue;
    let matched = 0;
    for (const tw of tTokens) {
      if (gTokens.some((gw) => wordClose(gw, tw))) matched += 1;
    }
    if (matched / tTokens.length >= 0.6) return true;
  }
  return false;
}
