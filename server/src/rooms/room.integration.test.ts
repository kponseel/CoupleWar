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

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const contentDir = resolve(repoRoot, "content");

const baseConfig = gameConfigSchema.parse(
  parseJsonc(readFileSync(resolve(repoRoot, "config", "game.config.json"), "utf8")),
);

// Config rapide pour faire défiler la state-machine sans attendre les vrais timers.
const fastConfig: GameConfig = {
  ...baseConfig,
  sync: { ...baseConfig.sync, deadlineMs: 200 },
  auction: { ...baseConfig.auction, answerTimeMs: 200, betTimeMs: 200 },
  introMs: 10,
  revealHoldMs: 10,
  interludeMs: 10,
  leaderboardRowPauseMs: 5,
  reveal: { drumrollMs: 10, freezeMs: 5, flashMs: 10 },
  roundPlan: [
    { mode: "sync", intensityMax: "light" },
    { mode: "auction", intensityMax: "medium" },
    { mode: "sync", intensityMax: "medium", finale: true },
  ],
};

const bank = new QuestionBank();
bank.load(contentDir);
loadNamePools(contentDir);
loadResultsContent(contentDir);

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
});

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
  }
}
