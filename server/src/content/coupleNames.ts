import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomInt } from "node:crypto";

interface NamePools {
  article: string;
  nouns: string[];
  adjectives: string[];
  blocklist: string[];
}

let pools: NamePools | null = null;

export function loadNamePools(contentDir: string): void {
  const raw = readFileSync(resolve(contentDir, "coupleNames.json"), "utf8");
  pools = JSON.parse(raw) as NamePools;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(arr.length)];
}

/** Génère N noms « Les [Nom] [Adjectif] » distincts (§4.3). */
export function generateCoupleNames(count = 3): string[] {
  if (!pools) throw new Error("Name pools non chargés");
  const seen = new Set<string>();
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 100) {
    const name = `${pools.article} ${pick(pools.nouns)} ${pick(pools.adjectives)}`;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Filtre anti-insultes basique + bornage de longueur (§4.3). */
export function sanitizeCoupleName(input: string): string {
  if (!pools) throw new Error("Name pools non chargés");
  const trimmed = input.trim().slice(0, 40);
  const lower = trimmed.toLowerCase();
  for (const bad of pools.blocklist) {
    if (lower.includes(bad)) {
      return generateCoupleNames(1)[0]; // remplace silencieusement par un nom propre
    }
  }
  return trimmed.length > 0 ? trimmed : generateCoupleNames(1)[0];
}
