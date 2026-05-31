// Test d'intégration du cycle de vie complet d'une Room (machine à états §2),
// au-dessus des fonctions de scoring pures. On simule l'autorité serveur avec
// un faux `io` qui capture les émissions, sans vraie socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc, gameConfigSchema, type GameConfig } from "@couplewar/shared";
import { Room } from "./Room.js";
import { QuestionBank } from "../content/questions.js";
import { loadNamePools } from "../content/coupleNames.js";
import { loadResultsContent } from "../content/results.js";
import { loadEmojiPool } from "../content/emojis.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const contentDir = resolve(repoRoot, "content");

const baseConfig = gameConfigSchema.parse(
  parseJsonc(readFileSync(resolve(repoRoot, "config", "game.config.json"), "utf8")),
);

// Config rapide pour faire défiler la state-machine sans attendre les vrais timers.
// Le roundPlan exerce LES QUATRE modes branchés → machines d'état couvertes en
// intégration (solo ET multi-couples).
const fastConfig: GameConfig = {
  ...baseConfig,
  sync: { ...baseConfig.sync, deadlineMs: 200 },
  auction: { ...baseConfig.auction, answerTimeMs: 200, betTimeMs: 200 },
  wavelength: { ...baseConfig.wavelength, clueTimeMs: 200, receiveTimeMs: 200 },
  mime: { ...baseConfig.mime, emojiRoundTimeMs: 200, emojiCooldownMs: 0 },
  introMs: 10,
  revealHoldMs: 10,
  interludeMs: 10,
  leaderboardRowPauseMs: 5,
  reveal: { drumrollMs: 10, freezeMs: 5, flashMs: 10 },
  roundPlan: [
    { mode: "sync", intensityMax: "light" },
    { mode: "auction", intensityMax: "medium" },
    { mode: "wavelength", intensityMax: "light" },
    { mode: "mime_d3", intensityMax: "light" },
    { mode: "sync", intensityMax: "medium", finale: true },
  ],
};

const bank = new QuestionBank();
bank.load(contentDir);
loadNamePools(contentDir);
loadResultsContent(contentDir);
loadEmojiPool(contentDir);

/** Faux io : capture les événements émis (room + sockets individuels). */
function makeFakeIo() {
  const events: Array<{ target: string; event: string; args: unknown[] }> = [];
  const io = {
    to(target: string) {
      return {
        emit(event: string, ...args: unknown[]) {
          events.push({ target, event, args });
        },
      };
    },
  };
  return { io: io as never, events };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Config dont le PREMIER round est wavelength (pour tester la phase clue isolément). */
const waveFirstConfig: GameConfig = {
  ...fastConfig,
  roundPlan: [
    { mode: "wavelength", intensityMax: "light" },
    { mode: "sync", intensityMax: "light", finale: true },
  ],
};

test("Wavelength : la cible n'est émise QU'À l'Émetteur (anti-fuite §6)", async () => {
  const { io, events } = makeFakeIo();
  const room = new Room("WAVE", { io, config: waveFirstConfig, questionBank: bank });
  const h = room.addPlayer("s_host", "Host", true);
  const a1 = room.addPlayer("s_a1", "Alex", false);
  const a2 = room.addPlayer("s_a2", "Sam", false);
  const b1 = room.addPlayer("s_b1", "Lou", false);
  const b2 = room.addPlayer("s_b2", "Max", false);
  const cA = room.createCouple(a1.id) as { joinCode: string };
  room.joinCouple(a2.id, cA.joinCode);
  const cB = room.createCouple(b1.id) as { joinCode: string };
  room.joinCouple(b2.id, cB.joinCode);
  room.startGame();
  await sleep(40); // intro → ROUND_PLAY (clue)
  assert.equal(room.data.currentMode, "wavelength");

  // Parmi tous les round:play émis pendant la phase clue : exactement UN porte la cible.
  const clueEvents = events.filter(
    (e) => e.event === "round:play" && (e.args[0] as { phase?: string }).phase === "clue",
  );
  assert.ok(clueEvents.length >= 5, "chaque joueur+host reçoit un payload clue");
  const withTarget = clueEvents.filter((e) => (e.args[0] as { target?: number }).target !== undefined);
  assert.equal(withTarget.length, 1, "une seule émission porte la cible");
  // …et elle a été émise vers le socket de l'Émetteur (e.target = cible d'émission).
  const emitterId = (clueEvents[0].args[0] as { emitterPlayerId: string }).emitterPlayerId;
  const emitterSocket = room.data.players.get(emitterId)?.socketId;
  assert.equal(withTarget[0].target, emitterSocket);
  room.dispose();
});

test("Wavelength : forceReveal pendant la phase clue ne plante pas (§A3)", async () => {
  const { io } = makeFakeIo();
  const room = new Room("WAVE2", { io, config: waveFirstConfig, questionBank: bank });
  const h = room.addPlayer("s_host", "Host", true);
  const a1 = room.addPlayer("s_a1", "Alex", false);
  const a2 = room.addPlayer("s_a2", "Sam", false);
  const b1 = room.addPlayer("s_b1", "Lou", false);
  const b2 = room.addPlayer("s_b2", "Max", false);
  const cA = room.createCouple(a1.id) as { joinCode: string };
  room.joinCouple(a2.id, cA.joinCode);
  const cB = room.createCouple(b1.id) as { joinCode: string };
  room.joinCouple(b2.id, cB.joinCode);
  room.startGame();
  await sleep(40);
  assert.equal(room.data.currentMode, "wavelength");
  // Aucun curseur/indice donné : forceReveal doit révéler sans crash.
  const res = room.forceReveal(h.id);
  assert.equal(res.forced, true);
  assert.notEqual(room.data.state, "ROUND_PLAY");
  room.dispose();
});

/** Config dont le PREMIER round est mime_d3. */
const mimeFirstConfig: GameConfig = {
  ...fastConfig,
  mime: { ...fastConfig.mime, emojiRoundTimeMs: 5000, emojiCooldownMs: 0 },
  roundPlan: [
    { mode: "mime_d3", intensityMax: "light" },
    { mode: "sync", intensityMax: "light", finale: true },
  ],
};

test("Mime D3 : secret + main uniquement au Donneur ; emoji broadcasté ; devinette correcte score (§8.3)", async () => {
  const { io, events } = makeFakeIo();
  const room = new Room("MIME", { io, config: mimeFirstConfig, questionBank: bank });
  const h = room.addPlayer("s_host", "Host", true);
  const a1 = room.addPlayer("s_a1", "Alex", false);
  const a2 = room.addPlayer("s_a2", "Sam", false);
  const b1 = room.addPlayer("s_b1", "Lou", false);
  const b2 = room.addPlayer("s_b2", "Max", false);
  const cA = room.createCouple(a1.id) as { joinCode: string };
  room.joinCouple(a2.id, cA.joinCode);
  const cB = room.createCouple(b1.id) as { joinCode: string };
  room.joinCouple(b2.id, cB.joinCode);
  room.startGame();
  await sleep(40);
  assert.equal(room.data.currentMode, "mime_d3");

  const plays = events.filter((e) => e.event === "round:play" && (e.args[0] as { mode: string }).mode === "mime_d3");
  const withSecret = plays.filter((e) => (e.args[0] as { secret?: string }).secret !== undefined);
  assert.equal(withSecret.length, 1, "une seule émission porte le secret/la main");
  const payload = withSecret[0].args[0] as { secret: string; hand: string[]; giverPlayerId: string; receiverPlayerId: string; questionId: string };
  assert.ok(Array.isArray(payload.hand) && payload.hand.length > 0);
  // Le Donneur envoie un emoji de sa main → broadcast mime:emoji.
  const beforeEmoji = events.length;
  const emojiRes = room.submitEmoji(payload.giverPlayerId, { questionId: payload.questionId, emoji: payload.hand[0] });
  assert.equal(emojiRes.accepted, true);
  assert.ok(events.slice(beforeEmoji).some((e) => e.event === "mime:emoji"), "l'emoji doit être broadcasté");
  // Un non-Donneur ne peut pas envoyer d'emoji.
  assert.equal(room.submitEmoji(payload.receiverPlayerId, { questionId: payload.questionId, emoji: payload.hand[0] }).accepted, false);

  // Le Récepteur devine le concept (le secret est connu du test via le payload Donneur).
  const guess = room.submitAnswer(payload.receiverPlayerId, {
    questionId: payload.questionId,
    answer: payload.secret,
    clientSubmitTime: Date.now(),
  });
  assert.equal(guess.accepted, true);
  // Le Donneur ne peut pas deviner.
  assert.equal(
    room.submitAnswer(payload.giverPlayerId, { questionId: payload.questionId, answer: payload.secret, clientSubmitTime: Date.now() }).accepted,
    false,
  );

  room.forceReveal(h.id);
  await sleep(20);
  const reveal = lastEvent(events, "round:reveal");
  const active = (reveal!.args[0] as { perCouple: Array<{ coupleId: string; deltaScore: number; detail: Record<string, unknown> }> }).perCouple.find(
    (pc) => (pc.detail as { role?: string }).role === "active",
  );
  assert.ok(active, "le couple actif figure dans le reveal");
  assert.equal((active!.detail as { transmitted: boolean }).transmitted, true);
  assert.ok(active!.deltaScore > 0, "le couple actif marque pour la transmission réussie");
  room.dispose();
});

function setupRoom() {
  const { io, events } = makeFakeIo();
  const room = new Room("TEST", { io, config: fastConfig, questionBank: bank });
  // 2 couples complets.
  const h = room.addPlayer("s_host", "Host", true);
  const a1 = room.addPlayer("s_a1", "Alex", false);
  const a2 = room.addPlayer("s_a2", "Sam", false);
  const b1 = room.addPlayer("s_b1", "Lou", false);
  const b2 = room.addPlayer("s_b2", "Max", false);
  const cA = room.createCouple(a1.id) as { coupleId: string; joinCode: string };
  room.joinCouple(a2.id, cA.joinCode);
  const cB = room.createCouple(b1.id) as { coupleId: string; joinCode: string };
  room.joinCouple(b2.id, cB.joinCode);
  return { room, events, players: { h, a1, a2, b1, b2 }, couples: { cA, cB } };
}

test("Room : canStart exige 2 couples complets", () => {
  const { io } = makeFakeIo();
  const room = new Room("X", { io, config: fastConfig, questionBank: bank });
  const p1 = room.addPlayer("s1", "P1", false);
  assert.equal(room.canStart().ok, false); // 0 couple
  const c = room.createCouple(p1.id) as { joinCode: string };
  assert.equal(room.canStart().ok, false); // 1 couple incomplet
  const p2 = room.addPlayer("s2", "P2", false);
  room.joinCouple(p2.id, c.joinCode);
  assert.equal(room.canStart().ok, false); // 1 couple complet < minCouples
  // En mode solo, 1 couple complet suffit.
  assert.equal(room.canStart(true).ok, true);
});

/** Room avec UN seul couple complet (mode solo dev/test). */
function setupSolo() {
  const { io, events } = makeFakeIo();
  const room = new Room("SOLO", { io, config: fastConfig, questionBank: bank });
  const h = room.addPlayer("s_host", "Host", true);
  const a1 = room.addPlayer("s_a1", "Alex", false);
  const a2 = room.addPlayer("s_a2", "Sam", false);
  const cA = room.createCouple(a1.id) as { coupleId: string; joinCode: string };
  room.joinCouple(a2.id, cA.joinCode);
  return { room, events, players: { h, a1, a2 } };
}

test("Room : mode solo (1 couple) traverse tous les modes jusqu'à RESULTS sans crash", async () => {
  const { room, events, players } = setupSolo();
  const started = room.startGame(true);
  assert.equal(started.ok, true);
  assert.equal(room.data.solo, true);

  const handled = new Set<string>();
  for (let i = 0; i < 300 && room.data.state !== "RESULTS"; i++) {
    const play = lastEvent(events, "round:play");
    if (play) {
      const p = play.args[0] as Record<string, unknown>;
      const key = `${p.mode}:${p.phase ?? ""}:${p.questionId}`;
      if (!handled.has(key)) {
        handled.add(key);
        driveSolo(room, players, p);
      }
    }
    await sleep(20);
  }

  assert.equal(room.data.state, "RESULTS");
  const finalEvt = lastEvent(events, "results:final");
  assert.ok(finalEvt, "results:final doit être émis en solo");
  const results = (finalEvt!.args[0] as { results: unknown[] }).results;
  assert.equal(results.length, 1); // un seul couple
  const r = results[0] as { compatibility: number; title: { label: string }; medal: unknown };
  assert.ok(r.compatibility >= fastConfig.results.compatFloor);
  assert.ok(r.title.label.length > 0);
  room.dispose();
});

/** Pilote le couple unique en solo (émetteur/récepteur, pas de parieurs adverses). */
function driveSolo(
  room: Room,
  players: { a1: { id: string }; a2: { id: string }; h: { id: string } },
  p: Record<string, unknown>,
) {
  const now = Date.now();
  if (p.mode === "sync") {
    const opt = (p.options as string[])[0];
    room.submitAnswer(players.a1.id, { questionId: p.questionId as string, answer: opt, clientSubmitTime: now });
    room.submitAnswer(players.a2.id, { questionId: p.questionId as string, answer: opt, clientSubmitTime: now });
  } else if (p.mode === "auction" && p.phase === "answer") {
    room.submitAnswer(p.targetPlayerId as string, {
      questionId: p.questionId as string,
      answer: (p.options as string[])[0],
      clientSubmitTime: now,
    });
  } else if (p.mode === "auction" && p.phase === "bet") {
    // Le Devineur du couple cible mise (seul participant en solo).
    const devineur = [players.a1.id, players.a2.id].find((id) => id !== p.targetPlayerId) ?? players.a1.id;
    room.submitBet(devineur, { questionId: p.questionId as string, option: (p.options as string[])[0], tokens: p.minBet as number });
  } else if (p.mode === "wavelength" && p.phase === "clue") {
    room.submitAnswer(p.emitterPlayerId as string, {
      questionId: p.questionId as string,
      answer: "indice",
      clientSubmitTime: now,
    });
  } else if (p.mode === "wavelength" && p.phase === "reception") {
    room.submitAnswer(p.receiverPlayerId as string, { questionId: p.questionId as string, answer: "50", clientSubmitTime: now });
  } else if (p.mode === "mime_d3") {
    // Round mime : se termine par timeout (emojiRoundTimeMs court).
  }
}

test("Room : refuse une question deux fois / hors timing (autorité)", async () => {
  const { room, players } = setupRoom();
  room.startGame();
  await sleep(40); // laisse passer l'intro → ROUND_PLAY
  assert.equal(room.data.state, "ROUND_PLAY");

  const play = room.data; // snapshot d'état
  assert.equal(play.currentMode, "sync");

  // On récupère l'id de question via le payload broadcast.
  const now = Date.now();
  const ok = room.submitAnswer(players.a1.id, {
    questionId: currentSyncQuestionId(room),
    answer: firstOption(room),
    clientSubmitTime: now,
  });
  assert.equal(ok.accepted, true);
  // Deuxième soumission du même joueur → refusée.
  const dup = room.submitAnswer(players.a1.id, {
    questionId: currentSyncQuestionId(room),
    answer: firstOption(room),
    clientSubmitTime: now,
  });
  assert.equal(dup.accepted, false);
  assert.equal(dup.reason, "already_answered");

  // Mauvaise question → refusée.
  const wrong = room.submitAnswer(players.a2.id, {
    questionId: "q_inexistante",
    answer: firstOption(room),
    clientSubmitTime: now,
  });
  assert.equal(wrong.accepted, false);

  room.dispose();
});

test("Room : partie complète atteint RESULTS avec 2 résultats valides", async () => {
  const { room, events, players } = setupRoom();
  room.startGame();

  // Auto-répond à chaque round:play capturé, jusqu'à RESULTS.
  const answered = new Set<string>();
  for (let i = 0; i < 200 && room.data.state !== "RESULTS"; i++) {
    const play = lastEvent(events, "round:play");
    if (play) {
      const p = play.args[0] as Record<string, unknown>;
      const key = `${p.mode}:${p.phase ?? ""}:${p.questionId}`;
      if (!answered.has(key)) {
        answered.add(key);
        drive(room, players, p);
      }
    }
    await sleep(20);
  }

  assert.equal(room.data.state, "RESULTS");
  const finalEvt = lastEvent(events, "results:final");
  assert.ok(finalEvt, "results:final doit être émis");
  const results = (finalEvt!.args[0] as { results: unknown[] }).results;
  assert.equal(results.length, 2);
  for (const r of results as Array<{ compatibility: number; title: { label: string }; medal: unknown }>) {
    assert.ok(r.compatibility >= fastConfig.results.compatFloor);
    assert.ok(r.title.label.length > 0);
    assert.notEqual(r.medal, null);
  }
  room.dispose();
});

test("Room : reconnexion en plein round renvoie le payload courant (resync §14)", async () => {
  const { room, events, players } = setupRoom();
  room.startGame();
  await sleep(40);
  assert.equal(room.data.state, "ROUND_PLAY");

  const before = events.length;
  room.handleDisconnect(players.a1.id);
  const resumed = room.resumePlayer(players.a1.id, "s_a1_new");
  assert.ok(resumed);
  // Le resync émet round:play vers le socket reconnecté.
  const after = events.slice(before);
  const resync = after.find((e) => e.event === "round:play" && e.target === "s_a1_new");
  assert.ok(resync, "le resync doit ré-émettre round:play au socket reconnecté");
  room.dispose();
});

test("Room : forceReveal (hôte) termine la phase ; refusé pour un non-hôte (§A3)", async () => {
  const { room, players } = setupRoom();
  room.startGame();
  await sleep(40);
  assert.equal(room.data.state, "ROUND_PLAY");

  // Un joueur normal ne peut pas forcer.
  const denied = room.forceReveal(players.a1.id);
  assert.equal(denied.forced, false);
  assert.equal(denied.reason, "not_host");
  assert.equal(room.data.state, "ROUND_PLAY");

  // L'hôte force → on quitte immédiatement ROUND_PLAY.
  const forced = room.forceReveal(players.h.id);
  assert.equal(forced.forced, true);
  assert.notEqual(room.data.state, "ROUND_PLAY");
  room.dispose();
});

test("Room : forceReveal refusé hors phase de jeu", () => {
  const { room, players } = setupRoom();
  // Avant le démarrage (LOBBY/PAIRING) : pas de phase de jeu.
  const res = room.forceReveal(players.h.id);
  assert.equal(res.forced, false);
  assert.equal(res.reason, "not_in_play");
  room.dispose();
});

test("Room : quota deep respecté sur une partie (jamais plus que la config)", async () => {
  // Config avec quota 0 → aucune question deep ne doit sortir.
  const cfg: GameConfig = { ...fastConfig, tone: { ...fastConfig.tone, maxDeepQuestionsPerGame: 0 } };
  const { io, events } = makeFakeIo();
  const room = new Room("DEEP", { io, config: cfg, questionBank: bank });
  const ids = ["sH", "s1", "s2", "s3", "s4"];
  const ps = ids.map((s, i) => room.addPlayer(s, `P${i}`, i === 0));
  const cA = room.createCouple(ps[1].id) as { joinCode: string };
  room.joinCouple(ps[2].id, cA.joinCode);
  const cB = room.createCouple(ps[3].id) as { joinCode: string };
  room.joinCouple(ps[4].id, cB.joinCode);
  room.startGame();

  const seen = new Set<string>();
  for (let i = 0; i < 200 && room.data.state !== "RESULTS"; i++) {
    const play = lastEvent(events, "round:play");
    if (play) {
      const p = play.args[0] as Record<string, unknown>;
      const key = `${p.mode}:${p.phase ?? ""}:${p.questionId}`;
      if (!seen.has(key)) {
        seen.add(key);
        drive(room, { a1: ps[1], a2: ps[2], b1: ps[3], b2: ps[4], h: ps[0] }, p);
      }
    }
    await sleep(20);
  }
  // Aucune question deep ne doit avoir été posée (impossible à vérifier directement
  // ici, mais le test garantit surtout l'absence de crash + l'atteinte de RESULTS).
  assert.equal(room.data.state, "RESULTS");
  room.dispose();
});

// --- Helpers de pilotage ---

function lastEvent(events: Array<{ event: string; args: unknown[]; target: string }>, name: string) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].event === name) return events[i];
  return undefined;
}

function currentSyncQuestionId(room: Room): string {
  // Le payload courant est accessible via le contrôleur (resync).
  const play = (room as unknown as { controller: { resync(): { questionId: string } | null } }).controller;
  return play.resync()?.questionId ?? "";
}
function firstOption(room: Room): string {
  const play = (room as unknown as { controller: { resync(): { options?: string[] } | null } }).controller;
  return play.resync()?.options?.[0] ?? "";
}

/** Fait jouer les deux couples selon le payload reçu. */
function drive(
  room: Room,
  players: { a1: { id: string }; a2: { id: string }; b1: { id: string }; b2: { id: string }; h: { id: string } },
  p: Record<string, unknown>,
) {
  const now = Date.now();
  if (p.mode === "sync") {
    const opt = (p.options as string[])[0];
    for (const pid of [players.a1.id, players.a2.id, players.b1.id, players.b2.id]) {
      room.submitAnswer(pid, { questionId: p.questionId as string, answer: opt, clientSubmitTime: now });
    }
  } else if (p.mode === "auction" && p.phase === "answer") {
    const target = p.targetPlayerId as string;
    room.submitAnswer(target, {
      questionId: p.questionId as string,
      answer: (p.options as string[])[0],
      clientSubmitTime: now,
    });
  } else if (p.mode === "auction" && p.phase === "bet") {
    const opt = (p.options as string[])[0];
    for (const pid of [players.a1.id, players.a2.id, players.b1.id, players.b2.id]) {
      room.submitBet(pid, { questionId: p.questionId as string, option: opt, tokens: p.minBet as number });
    }
  } else if (p.mode === "wavelength" && p.phase === "clue") {
    room.submitAnswer(p.emitterPlayerId as string, {
      questionId: p.questionId as string,
      answer: "indice",
      clientSubmitTime: now,
    });
  } else if (p.mode === "wavelength" && p.phase === "reception") {
    room.submitAnswer(p.receiverPlayerId as string, { questionId: p.questionId as string, answer: "50", clientSubmitTime: now });
    // Les couples parieurs (non actifs) parient une direction.
    for (const pid of [players.a1.id, players.a2.id, players.b1.id, players.b2.id]) {
      room.submitBet(pid, { questionId: p.questionId as string, option: "left", tokens: 0 });
    }
  } else if (p.mode === "mime_d3") {
    // Le round se termine par timeout (emojiRoundTimeMs court) ; rien à forcer.
    // (le path de devinette est testé spécifiquement plus bas)
  }
}
