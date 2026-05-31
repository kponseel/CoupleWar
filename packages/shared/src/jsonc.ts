/**
 * Minuscule parseur JSONC : retire les commentaires `//` et les blocs `/* * /`
 * (en respectant les chaînes), puis JSON.parse. Permet d'avoir un fichier de
 * config commenté tout en restant du JSON pur côté machine.
 */
export function parseJsonc<T = unknown>(input: string): T {
  let out = "";
  let inString = false;
  let stringQuote = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        // copie le caractère échappé tel quel
        out += input[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += c;
  }

  // Retire les virgules traînantes éventuelles (tolérance JSONC).
  const cleaned = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned) as T;
}
