// e2e mode SOLO : 1 hôte + 1 couple (2 joueurs), traverse une partie complète
// (sync, auction, wavelength, finale) jusqu'aux résultats. Vérifie que les modes
// inter-couples dégradent proprement avec un seul couple.
import pkg from "socket.io-client";
const { io } = pkg;

const URL = process.env.E2E_URL ?? "http://localhost:3071";
const log = (...a) => console.log("•", ...a);
const fail = (m) => { console.error("✗", m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect() { return io(URL, { transports: ["websocket"], forceNew: true, reconnection: false }); }
function ack(s, ev, p) { return new Promise((res) => (p === undefined ? s.emit(ev, res) : s.emit(ev, p, res))); }
function waitState(s, st, t = 25000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("timeout " + st)), t);
    const h = (snap) => { if (snap.state === st) { clearTimeout(to); s.off("room:state", h); resolve(snap); } };
    s.on("room:state", h);
  });
}
setTimeout(() => fail("timeout global"), 40000).unref();

async function main() {
  const host = connect();
  await new Promise((r) => host.on("connect", r));
  const created = await ack(host, "room:create");
  const code = created.data.roomCode;
  log("room", code);

  const players = [];
  for (const name of ["Alex", "Sam"]) {
    const s = connect();
    await new Promise((r) => s.on("connect", r));
    const j = await ack(s, "room:join", { roomCode: code, name });
    players.push({ s, name, id: j.data.playerId });
  }
  const c = await ack(players[0].s, "pairing:createCouple");
  await ack(players[1].s, "pairing:joinCouple", { joinCode: c.data.joinCode });
  for (const p of players) await ack(p.s, "pairing:ready", { ready: true });
  log("1 couple formé");

  // Refus du mode normal (1 couple < minCouples), accepté en solo.
  const normal = await ack(host, "game:start", {});
  if (normal.ok) fail("le démarrage normal aurait dû échouer (1 couple seulement)");
  log("démarrage normal refusé (attendu) :", normal.error);

  for (const p of players) {
    p.s.on("round:play", (play) => {
      const now = Date.now();
      if (play.mode === "sync") {
        p.s.emit("answer:submit", { questionId: play.questionId, answer: play.options[0], clientSubmitTime: now }, () => {});
      } else if (play.mode === "auction" && play.phase === "answer") {
        if (play.targetPlayerId === p.id) p.s.emit("answer:submit", { questionId: play.questionId, answer: play.options[0], clientSubmitTime: now }, () => {});
      } else if (play.mode === "auction" && play.phase === "bet") {
        // Le Devineur (non-cible du couple) mise.
        p.s.emit("auction:bet", { questionId: play.questionId, option: play.options[0], tokens: play.minBet }, () => {});
      } else if (play.mode === "wavelength" && play.phase === "clue") {
        if (play.emitterPlayerId === p.id) p.s.emit("answer:submit", { questionId: play.questionId, answer: "indice", clientSubmitTime: now }, () => {});
      } else if (play.mode === "wavelength" && play.phase === "reception") {
        if (play.receiverPlayerId === p.id) p.s.emit("answer:submit", { questionId: play.questionId, answer: "50", clientSubmitTime: now }, () => {});
      }
    });
  }

  let results = null;
  host.on("results:final", (r) => { results = r.results; });

  const solo = await ack(host, "game:start", { solo: true });
  if (!solo.ok) fail("démarrage solo refusé : " + solo.error);
  log("partie solo lancée");

  await waitState(host, "RESULTS", 35000);
  await sleep(400);
  if (!results) fail("aucun results:final");
  if (results.length !== 1) fail("attendu 1 résultat, reçu " + results.length);
  const r = results[0];
  if (r.compatibility < 67) fail("compat < 67");
  if (!r.title?.label) fail("titre manquant");
  log(`résultat : ${r.name} — ${r.title.emoji} ${r.title.label} · ${r.compatibility}% · ${r.medal ? r.medal.label : "—"}`);

  console.log("\n✓ E2E SOLO OK : 1 couple traverse sync→auction→wavelength→finale→résultats.");
  process.exit(0);
}
main().catch((e) => fail(e.message ?? String(e)));
