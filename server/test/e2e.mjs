// Test end-to-end : simule une partie complète (hôte + 2 couples) avec une
// déconnexion/reconnexion en plein jeu. Lance le serveur séparément avec la
// config rapide, puis : node server/test/e2e.mjs
import { io } from "socket.io-client";

const URL = process.env.E2E_URL ?? "http://localhost:3099";
const log = (...a) => console.log("•", ...a);
const fail = (msg) => {
  console.error("✗ ÉCHEC:", msg);
  process.exit(1);
};

function connect() {
  return io(URL, { transports: ["websocket"], forceNew: true });
}
function ack(sock, ev, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) sock.emit(ev, resolve);
    else sock.emit(ev, payload, resolve);
  });
}
function waitState(sock, state, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout state ${state}`)), timeoutMs);
    const onState = (snap) => {
      if (snap.state === state) {
        clearTimeout(t);
        sock.off("room:state", onState);
        resolve(snap);
      }
    };
    sock.on("room:state", onState);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // --- Hôte crée la room ---
  const host = connect();
  await new Promise((r) => host.on("connect", r));
  const created = await ack(host, "room:create");
  if (!created.ok) fail("room:create");
  const code = created.data.roomCode;
  log("Room créée:", code);

  // --- 4 joueurs rejoignent ---
  const players = [];
  for (const name of ["Alex", "Sam", "Lou", "Max"]) {
    const p = connect();
    await new Promise((r) => p.on("connect", r));
    const j = await ack(p, "room:join", { roomCode: code, name });
    if (!j.ok) fail(`join ${name}`);
    players.push({ sock: p, name, id: j.data.playerId });
  }
  log("4 joueurs connectés");

  // --- Appariement : couple A (Alex+Sam), couple B (Lou+Max) ---
  const cA = await ack(players[0].sock, "pairing:createCouple");
  if (!cA.ok) fail("createCouple A");
  const jA = await ack(players[1].sock, "pairing:joinCouple", { joinCode: cA.data.joinCode });
  if (!jA.ok) fail("joinCouple A");

  const cB = await ack(players[2].sock, "pairing:createCouple");
  if (!cB.ok) fail("createCouple B");
  const jB = await ack(players[3].sock, "pairing:joinCouple", { joinCode: cB.data.joinCode });
  if (!jB.ok) fail("joinCouple B");
  log("2 couples formés");

  // --- Tous prêts ---
  for (const p of players) await ack(p.sock, "pairing:ready", { ready: true });

  // --- Chaque joueur répond automatiquement aux rounds ---
  const offsets = new Map();
  for (const p of players) {
    const off = await calibrate(p.sock);
    offsets.set(p.id, off);
    wirePlayer(p, offsets);
  }

  let resultsReceived = null;
  host.on("results:final", (r) => {
    resultsReceived = r.results;
  });

  // --- Lancement ---
  const start = await ack(host, "game:start");
  if (!start.ok) fail(`game:start: ${start.error}`);
  log("Partie lancée");

  // --- Déconnexion/reconnexion d'un joueur pendant le 1er round (§14) ---
  await waitState(host, "ROUND_PLAY");
  log("Round 1 en cours → on déconnecte Alex 1s puis on le reconnecte");
  const alex = players[0];
  alex.sock.disconnect();
  await sleep(1000);
  const re = connect();
  await new Promise((r) => re.on("connect", r));
  // Comme le vrai client (initConnection branche les listeners AVANT room:resume),
  // on attache l'écouteur round:play avant de reprendre la session.
  alex.sock = re;
  const off = await calibrate(re);
  offsets.set(alex.id, off);
  alex.gotPlay = 0;
  wirePlayer(alex, offsets);
  const resumed = await ack(re, "room:resume", { roomCode: code, playerId: alex.id });
  if (!resumed.ok) fail(`resume Alex: ${resumed.error}`);
  await sleep(300); // laisse le resync arriver
  if (!alex.gotPlay) fail("Alex reconnecté n'a pas reçu le resync de la phase en cours");
  log("Alex reconnecté + resync de la phase en cours reçu ✓");

  // --- Attendre les résultats ---
  await waitState(host, "RESULTS", 60000);
  await sleep(500);
  if (!resultsReceived) fail("aucun results:final reçu");
  if (resultsReceived.length !== 2) fail(`attendu 2 résultats, reçu ${resultsReceived.length}`);
  for (const r of resultsReceived) {
    if (r.compatibility < 67) fail(`compat < 67 pour ${r.name}`);
    if (!r.title?.label) fail(`titre manquant pour ${r.name}`);
  }
  log("Résultats reçus:");
  for (const r of resultsReceived) {
    log(`   ${r.name}: ${r.title.emoji} ${r.title.label} · ${r.compatibility}% · ${r.medal ? r.medal.label : "—"} · ${r.totalScore} pts`);
  }

  console.log("\n✓ E2E OK : lobby → pairing → sync → enchères → finale → résultats, avec reconnexion.");
  process.exit(0);
}

async function calibrate(sock) {
  const t0 = performance.now();
  const serverTime = await new Promise((res) => sock.emit("clock:ping", res));
  const t1 = performance.now();
  return serverTime - (t0 + (t1 - t0) / 2);
}

function wirePlayer(p, offsets) {
  p.sock.removeAllListeners("round:play");
  p.sock.on("round:play", (play) => {
    p.gotPlay = (p.gotPlay ?? 0) + 1;
    const submitTime = performance.now() + (offsets.get(p.id) ?? 0);
    if (play.mode === "sync") {
      // Couple A (Alex+Sam) répond pareil → match ; couple B diverge.
      const idx = p.name === "Alex" || p.name === "Sam" ? 0 : p.name === "Lou" ? 0 : 1;
      const answer = play.options[idx] ?? play.options[0];
      p.sock.emit("answer:submit", { questionId: play.questionId, answer, clientSubmitTime: submitTime }, () => {});
    } else if (play.mode === "auction" && play.phase === "answer") {
      if (play.targetPlayerId === p.id) {
        p.sock.emit("answer:submit", { questionId: play.questionId, answer: play.options[0], clientSubmitTime: submitTime }, () => {});
      }
    } else if (play.mode === "auction" && play.phase === "bet") {
      const tokens = Math.min(play.maxBet, 5);
      const option = play.options[0];
      p.sock.emit("auction:bet", { questionId: play.questionId, option, tokens }, () => {});
    }
  });
}

main().catch((e) => fail(e.message ?? String(e)));
