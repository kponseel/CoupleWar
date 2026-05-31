import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { Server } from "socket.io";
import { clientDistDir, loadConfig, loadEnv } from "./env.js";
import { QuestionBank } from "./content/questions.js";
import { loadNamePools } from "./content/coupleNames.js";
import { loadResultsContent } from "./content/results.js";
import { loadEmojiPool } from "./content/emojis.js";
import { RoomManager } from "./rooms/RoomManager.js";
import { registerSocketHandlers } from "./net/socket.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const config = loadConfig(env.configPath);

  // Chargement du contenu seed (questions, noms, titres/métaphores).
  const bank = new QuestionBank();
  bank.load(env.contentDir);
  loadNamePools(env.contentDir);
  loadResultsContent(env.contentDir);
  loadEmojiPool(env.contentDir);

  const app = express();
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, configVersion: config.configVersion });
  });

  // En prod, sert le front PWA buildé (client/dist) same-origin.
  if (env.serveStatic && existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.get("*", (_req, res) => {
      res.sendFile(join(clientDistDir, "index.html"));
    });
  }

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, methods: ["GET", "POST"] },
    // Réduit la surface DoS : les payloads de jeu sont minuscules (réponses,
    // mises, indices courts). 64 KB est très large pour ça et coupe les abus.
    maxHttpBufferSize: 64_000,
  });

  const rooms = new RoomManager(io, config, bank);
  rooms.startReaper(); // libère les rooms abandonnées (in-memory)
  registerSocketHandlers(io, rooms);

  httpServer.listen(env.port, env.host, () => {
    console.log(
      `[CoupleWar] serveur prêt sur http://${env.host}:${env.port} (config v${config.configVersion}, static=${env.serveStatic})`,
    );
  });
}

main().catch((err) => {
  console.error("[CoupleWar] échec démarrage:", err);
  process.exit(1);
});
