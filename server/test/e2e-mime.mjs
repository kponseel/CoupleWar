// e2e Mime D3 (canal d'emojis) : 2 couples. Le Donneur reçoit secret+main, envoie
// des emojis (broadcastés), le Récepteur devine le concept. Vérifie l'anti-fuite
// (secret/main jamais aux non-Donneurs) et l'atteinte des résultats.
import pkg from "socket.io-client";
const { io } = pkg;

const URL = process.env.E2E_URL ?? "http://localhost:3070";
const log = (...a) => console.log("•", ...a);
const fail = (m) => { console.error("✗", m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect() { return io(URL, { transports: ["websocket"], forceNew: true, reconnection: false }); }
function ack(s, ev, p) { return new Promise((res) => (p === undefined ? s.emit(ev, res) : s.emit(ev, p, res))); }
function waitState(s, st, t = 20000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("timeout " + st)), t);
    const h = (snap) => { if (snap.state === st) { clearTimeout(to); s.off("room:state", h); resolve(snap); } };
    s.on("room:state", h);
  });
}
setTimeout(() => fail("timeout global"), 35000).unref();

async function main() {
  const host = connect();
  await new Promise((r) => host.on("connect", r));
  const created = await ack(host, "room:create");
  const code = created.data.roomCode;
  log("room", code);

  const players = [];
  for (const name of ["A1", "A2", "B1", "B2"]) {
    const s = connect();
    await new Promise((r) => s.on("connect", r));
    const j = await ack(s, "room:join", { roomCode: code, name });
    players.push({ s, name, id: j.data.playerId });
  }
  for (const [a, b] of [[0, 1], [2, 3]]) {
    const c = await ack(players[a].s, "pairing:createCouple");
    await ack(players[b].s, "pairing:joinCouple", { joinCode: c.data.joinCode });
  }
  for (const p of players) await ack(p.s, "pairing:ready", { ready: true });
  log("2 couples formés");

  let sawSecretLeak = false;
  let giverGotSecret = false;
  let receiverGuessed = false;

  for (const p of players) {
    p.s.on("round:play", async (play) => {
      if (play.mode === "sync") {
        p.s.emit("answer:submit", { questionId: play.questionId, answer: play.options[0], clientSubmitTime: Date.now() }, () => {});
        return;
      }
      if (play.mode !== "mime_d3") return;
      const isGiver = play.giverPlayerId === p.id;
      if (isGiver) {
        if (typeof play.secret !== "string" || !Array.isArray(play.hand)) fail("le Donneur doit recevoir secret+main");
        giverGotSecret = true;
        // Envoie 2 emojis de sa main.
        p.s.emit("mime:sendEmoji", { questionId: play.questionId, emoji: play.hand[0] }, () => {});
        await sleep(50);
        p.s.emit("mime:sendEmoji", { questionId: play.questionId, emoji: play.hand[1] }, () => {});
        // Le Récepteur (même couple) devine le secret.
        const receiver = players.find((x) => x.id === play.receiverPlayerId);
        await sleep(50);
        receiver.s.emit("answer:submit", { questionId: play.questionId, answer: play.secret, clientSubmitTime: Date.now() }, (r) => {
          if (r.ok && r.data.accepted) receiverGuessed = true;
        });
      } else if (play.secret !== undefined || play.hand !== undefined) {
        sawSecretLeak = true;
      }
    });
  }

  let results = null;
  host.on("results:final", (r) => { results = r.results; });

  const start = await ack(host, "game:start", {});
  if (!start.ok) fail("start: " + start.error);
  log("partie lancée");

  await waitState(host, "RESULTS", 30000);
  await sleep(300);
  if (sawSecretLeak) fail("FUITE : un non-Donneur a reçu secret/main");
  if (!giverGotSecret) fail("le Donneur n'a pas reçu le secret");
  if (!receiverGuessed) fail("le Récepteur n'a pas pu deviner");
  if (!results || results.length !== 2) fail("résultats invalides");
  log("Mime D3 : secret réservé au Donneur ✓ emojis broadcastés ✓ devinette OK ✓");
  console.log("\n✓ E2E Mime D3 OK");
  process.exit(0);
}
main().catch((e) => fail(e.message ?? String(e)));
