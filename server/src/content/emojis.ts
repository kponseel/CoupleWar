import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomInt } from "node:crypto";

let pool: string[] = [];

export function loadEmojiPool(contentDir: string): void {
  const raw = readFileSync(resolve(contentDir, "emojiPool.json"), "utf8");
  pool = JSON.parse(raw) as string[];
}

/** Tire `n` emojis distincts au hasard dans le pool (main du Donneur, §8.3). */
export function dealEmojis(n: number): string[] {
  if (pool.length === 0) throw new Error("Emoji pool non chargé");
  const count = Math.min(n, pool.length);
  const idx = new Set<number>();
  while (idx.size < count) idx.add(randomInt(pool.length));
  return [...idx].map((i) => pool[i]);
}

export function emojiPoolSize(): number {
  return pool.length;
}
