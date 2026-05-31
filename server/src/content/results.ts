import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TitleDef {
  emoji: string;
  label: string;
  blurb: string;
}
export interface MedalDef {
  emoji: string;
  label: string;
}
export interface ResultsContent {
  titles: Record<string, TitleDef>;
  medals: Record<string, MedalDef>;
  metaphors: Array<{ min: number; max: number; lines: string[] }>;
}

let content: ResultsContent | null = null;

export function loadResultsContent(contentDir: string): void {
  const titlesRaw = JSON.parse(readFileSync(resolve(contentDir, "titles.json"), "utf8")) as {
    titles: Record<string, TitleDef>;
    medals: Record<string, MedalDef>;
  };
  const metaRaw = JSON.parse(readFileSync(resolve(contentDir, "metaphors.json"), "utf8")) as {
    tiers: Array<{ min: number; max: number; lines: string[] }>;
  };
  content = { titles: titlesRaw.titles, medals: titlesRaw.medals, metaphors: metaRaw.tiers };
}

export function getResultsContent(): ResultsContent {
  if (!content) throw new Error("Results content non chargé");
  return content;
}
