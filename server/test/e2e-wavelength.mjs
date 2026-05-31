// e2e ciblé Wavelength : vérifie le cycle clue → reception → reveal sur un round
// wavelength (3 couples : 1 actif émetteur/récepteur, 2 parieurs).
import { io } from "socket.io-client";

const URL = process.env.E2E_URL ?? "http://localhost:3081";
const log = (...a) => console.log("•", ...a);
const fail = (m) => { console.error("✗", m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect() { return io(URL, { transports: ["websocket"], forceNew: true, reconnection: false }); }
function ack(s, ev, p) { return new Promise((res) => (p === undefined ? s.emit(ev, res) : s.emit(ev, p, res))); }
function waitState(s, st, t = 15000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("timeout " + st)), t);
    const h = (snap) => { if (snap.state === st) { clearTimeout(to); s.off("room:state", h); resolve(snap); } };
    s.on("room:state", h);
  });
}
setTimeout(() => fail("timeout global"), 30000).unref();

async function main() {
  const host = connect();
  await new Promise((r) => host.on("connect", r));
  const created = await ack(host, "room:create");
  const code = created.data.roomCode;
  log("room", code);

  const players = [];
  for (const name of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
    const s = connect();
    await new Promise((r) => s.on("connect", r));
    const j = await ack(s, "room:join", { roomCode: code, name });
    players.push({ s, name, id: j.data.playerId });
  }
  // 3 couples
  for (const [a, b] of [[0, 1], [2, 3], [4, 5]]) {
    const c = await ack(players[a].s, "pairing:createCouple");
    await ack(players[b].s, "pairing:joinCouple", { joinCode: c.data.joinCode });
  }
  for (const p of players) await ack(p.s, "pairing:ready", { ready: true });

  let sawClue = false, sawReception = false, revealOk = false;
  for (const p of players) {
    p.s.on("round:play", (play) => {
      if (play.mode !== "wavelength") {
        // round sync finale : tout le monde répond pareil
        if (play.mode === "sync") p.s.emit("answer:submit", { questionId: play.questionId, answer: play.options[0], clientSubmitTime: Date.now() }, () => {});
        return;
      }
      if (play.phase === "clue") {
        sawClue = true;
        if (play.emitterPlayerId === p.id) {
          if (typeof play.target !== "number") fail("l'émetteur doit recevoir la cible");
          p.s.emit("answer:submit", { questionId: play.questionId, answer: "mon indice", clientSubmitTime: Date.now() }, () => {});
        } else if (play.target !== undefined) {
          fail("un non-émetteur NE doit PAS recevoir la cible");
        }
      } else if (play.phase === "reception") {
        sawReception = true;
        if (play.receiverPlayerId === p.id) {
          p.s.emit("answer:submit", { questionId: play.questionId, answer: "50", clientSubmitTime: Date.now() }, () => {});
        } else {
          // parieurs (couples non actifs)
          p.s.emit("auction:bet", { questionId: play.questionId, option: "bullseye", tokens: 0 }, () => {});
        }
      }
    });
  }
  host.on("round:reveal", (r) => { if (r.mode === "wavelength") revealOk = true; });

  const start = await ack(host, "game:start", {});
  if (!start.ok) fail("start: " + start.error);
  log("partie lancée");

  await waitState(host, "RESULTS", 25000);
  if (!sawClue) fail("phase clue non vue");
  if (!sawReception) fail("phase reception non vue");
  if (!revealOk) fail("reveal wavelength non vu");
  log("Wavelength : clue ✓ reception ✓ reveal ✓ (cible cachée aux non-émetteurs)");
  console.log("\n✓ E2E Wavelength OK");
  process.exit(0);
}
main().catch((e) => fail(e.message ?? String(e)));
