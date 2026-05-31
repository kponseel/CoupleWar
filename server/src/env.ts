import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parseJsonc, gameConfigSchema, type GameConfig } from "@couplewar/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Racine du repo (server/src -> ../../). */
const repoRoot = resolve(__dirname, "..", "..");

export interface Env {
  port: number;
  host: string;
  /** Origines CORS autorisées en dev. En prod, le front est servi same-origin. */
  corsOrigins: string[];
  /** Sert le front buildé (client/dist) si présent. Activé en prod. */
  serveStatic: boolean;
  configPath: string;
  contentDir: string;
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const serveStatic = process.env.SERVE_STATIC === "true" || process.env.NODE_ENV === "production";
  const configPath = process.env.COUPLEWAR_CONFIG_PATH
    ? resolve(process.env.COUPLEWAR_CONFIG_PATH)
    : resolve(repoRoot, "config", "game.config.json");
  const contentDir = process.env.COUPLEWAR_CONTENT_DIR
    ? resolve(process.env.COUPLEWAR_CONTENT_DIR)
    : resolve(repoRoot, "content");
  return { port, host, corsOrigins, serveStatic, configPath, contentDir };
}

/** Charge et valide la config centralisée (§11). Lève si invalide. */
export function loadConfig(configPath: string): GameConfig {
  const raw = readFileSync(configPath, "utf8");
  const parsed = parseJsonc(raw);
  const result = gameConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Config invalide (${configPath}):\n${JSON.stringify(result.error.format(), null, 2)}`,
    );
  }
  return result.data;
}

export const clientDistDir = resolve(repoRoot, "client", "dist");
