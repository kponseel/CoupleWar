import confetti from "canvas-confetti";
import type { Options as ConfettiOptions, Shape } from "canvas-confetti";
import { socket } from "./socket.js";
import { calibrateClock } from "./clockSync.js";
import { setClockOffset, delayUntil } from "./clock.js";
import { useStore, loadSession, clearSession } from "../store/store.js";
import { sfx, speak } from "../audio/audio.js";

let heartShape: Shape | null = null;
let resuming = false;

/** Branche tous les écouteurs socket → store. Appelé une fois au démarrage. */
export function initConnection(): void {
  const { set } = useStore.getState();

  try {
    heartShape = confetti.shapeFromText({ text: "❤️", scalar: 2 });
  } catch {
    heartShape = null;
  }

  // `connect` se déclenche à la 1re connexion ET à chaque reconnexion auto.
  socket.on("connect", () => {
    set({ connected: true });
    void recalibrateAndResume();
  });

  socket.on("disconnect", (reason) => {
    set({ connected: false });
    // Si le serveur a coupé volontairement, on relance la connexion.
    if (reason === "io server disconnect") socket.connect();
  });

  socket.io.on("reconnect_attempt", () => set({ connected: false }));
  // Échec définitif de reconnexion : on le signale clairement à l'utilisateur.
  socket.io.on("reconnect_failed", () => set({ connected: false, error: "connection_lost" }));

  socket.on("room:state", (snapshot) => {
    const prev = useStore.getState().snapshot;
    const patch: Parameters<typeof set>[0] = { snapshot };
    if (snapshot.state === "LOBBY" || snapshot.state === "PAIRING") {
      patch.play = null;
      patch.reveal = null;
      patch.results = null;
      patch.intro = null;
    }
    if (prev?.state !== snapshot.state) {
      // Changement de phase : on purge les FX en attente (anti FX fantôme).
      cancelPendingFx();
      if (snapshot.state === "RESULTS") sfx.success();
    }
    set(patch);
  });

  socket.on("round:intro", (p) => {
    set({
      intro: { round: p.round, mode: p.mode, rule: p.rule, isFinale: p.isFinale },
      reveal: null,
      play: null,
      answered: false,
      betPlaced: false,
      isTargetThisRound: false,
    });
    if (useStore.getState().role === "host" && p.rule) {
      speak(p.isFinale ? "Finale !" : modeLabel(p.mode));
    }
  });

  socket.on("round:play", (p) => {
    const patch: Parameters<typeof set>[0] = { play: p, reveal: null };
    if (p.mode === "auction" && p.phase === "answer") {
      const myId = useStore.getState().playerId;
      patch.isTargetThisRound = p.targetPlayerId === myId;
      patch.answered = false;
      patch.betPlaced = false;
    } else if (p.mode === "sync") {
      patch.answered = false;
    }
    set(patch);
  });

  socket.on("answer:ack", () => set({ answered: true }));
  socket.on("round:reveal", (p) => set({ reveal: p }));
  socket.on("leaderboard:update", (p) =>
    set({ leaderboard: { entries: p.entries, rowPauseMs: p.rowPauseMs, topReserved: p.topReserved } }),
  );
  socket.on("score:update", () => {
    /* le snapshot porte déjà les scores ; hook pour animations futures */
  });
  socket.on("results:final", (p) => set({ results: p.results }));
  socket.on("error", (p) => set({ error: p.message || p.code }));

  // FX synchronisés multi-écrans (§10.2) : déclenchés au `executeAt` local.
  // On borne le délai (offset d'horloge aberrant → FX ne doit pas partir dans
  // un futur lointain) et on tracke le timer pour pouvoir l'annuler.
  socket.on("fx", (fx) => {
    const delay = Math.min(10_000, Math.max(0, delayUntil(fx.executeAt)));
    const t = window.setTimeout(() => {
      fxTimers.delete(t);
      runFx(fx);
    }, delay);
    fxTimers.add(t);
  });
}

/** Timers de FX en attente, annulés à un changement d'état de room (anti FX fantôme). */
const fxTimers = new Set<number>();

function cancelPendingFx(): void {
  for (const t of fxTimers) window.clearTimeout(t);
  fxTimers.clear();
}

/** Recalibre l'horloge puis tente de reprendre la session (§3.2 / §14). */
async function recalibrateAndResume(): Promise<void> {
  const { set } = useStore.getState();
  const offset = await calibrateClock(socket, 5, 150);
  setClockOffset(offset);
  set({ clockReady: true });

  if (resuming) return;
  const session = loadSession();
  // On reprend si une session existe (1re connexion OU reconnexion après coupure).
  if (session) {
    resuming = true;
    // Garde anti-blocage : si l'ACK ne revient jamais (coupure pendant le resume),
    // on relâche le flag pour qu'une reconnexion ultérieure puisse réessayer (§14).
    const guard = window.setTimeout(() => {
      resuming = false;
    }, 8000);
    socket.emit("room:resume", { roomCode: session.roomCode, playerId: session.playerId }, (res) => {
      clearTimeout(guard);
      resuming = false;
      if (res.ok) {
        set({ role: session.role, roomCode: session.roomCode, playerId: session.playerId });
      } else {
        // Room expirée / joueur inconnu : on nettoie, on revient à l'accueil et
        // on explique pourquoi (sinon le retour brutal au lobby est déroutant).
        clearSession();
        set({ role: null, roomCode: null, playerId: null, error: "room_expired" });
      }
    });
  }
}

function runFx(fx: { kind: string; color?: string; durationMs?: number; coupleId?: string }): void {
  const { set } = useStore.getState();
  switch (fx.kind) {
    case "flash":
      set({ flash: { color: fx.color ?? "#ffffff", durationMs: fx.durationMs ?? 200, nonce: Date.now() } });
      sfx.flash();
      break;
    case "drumroll":
      sfx.drumroll(fx.durationMs ?? 1500);
      break;
    case "hearts":
      rainHearts();
      break;
    case "heartbeat":
      set({ heartbeatCoupleId: fx.coupleId ?? null });
      sfx.aligned();
      window.setTimeout(() => useStore.getState().set({ heartbeatCoupleId: null }), 2500);
      break;
    default:
      break;
  }
}

function rainHearts(): void {
  const opts: ConfettiOptions = {
    particleCount: 60,
    spread: 70,
    origin: { y: 0.6 },
    colors: ["#e0245e", "#ff5e8a", "#ffd84d"],
  };
  if (heartShape) {
    opts.shapes = [heartShape];
    opts.scalar = 2;
  }
  void confetti(opts);
}

function modeLabel(mode: string): string {
  if (mode === "sync") return "Sync !";
  if (mode === "auction") return "Aux enchères de l'autre !";
  return mode;
}
