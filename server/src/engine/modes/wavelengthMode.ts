import { randomInt } from "node:crypto";
import type { FxEvent, PlayPayload, RevealPayload } from "@couplewar/shared";
import type { ModeFactory, RoundController, RoundContext } from "./types.js";
import { scoreWavelength, type BetDirection } from "../../scoring/wavelength.js";

const DIRECTIONS: BetDirection[] = ["left", "bullseye", "right"];

/**
 * Mode B — Wavelength (§6). Un couple actif : l'Émetteur voit la cible et donne
 * UN mot ; le Récepteur place le curseur. Les autres couples parient la direction.
 */
export const createWavelengthMode: ModeFactory = (ctx: RoundContext): RoundController => {
  const cfg = ctx.config.wavelength;
  const q = ctx.question;
  const poles = q.wavelength ?? { poleLeft: "0", poleRight: "100" };

  // Couple actif + rôles (rotation à chaque round Wavelength, §6.3).
  const activeCouple = ctx.couples[ctx.modeRoundIndex % ctx.couples.length];
  const emitterId = activeCouple.playerIds[ctx.modeRoundIndex % 2] ?? activeCouple.playerIds[0];
  const receiverId = activeCouple.playerIds.find((p) => p !== emitterId) ?? activeCouple.playerIds[0];

  const target = randomInt(8, 93); // évite les bords extrêmes
  let phase: "clue" | "reception" | "over" = "clue";
  let serverStartTime = 0;
  let deadline = 0;
  let clue: string | null = null;
  let cursor: number | null = null;
  const bets = new Map<string, BetDirection>(); // coupleId → direction
  let timer: NodeJS.Timeout | null = null;
  /** Payload diffusé (sans la cible) — base du resync. */
  let publicPayload: PlayPayload | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function coupleOf(playerId: string): string | null {
    return ctx.playersById.get(playerId)?.coupleId ?? null;
  }

  function startReception() {
    if (phase !== "clue") return;
    phase = "reception";
    clearTimer();
    serverStartTime = ctx.clock.now();
    deadline = serverStartTime + cfg.receiveTimeMs;
    publicPayload = {
      mode: "wavelength",
      phase: "reception",
      questionId: q.id,
      text: q.text,
      poleLeft: poles.poleLeft,
      poleRight: poles.poleRight,
      clue: clue ?? "—",
      emitterCoupleId: activeCouple.id,
      receiverPlayerId: receiverId,
      serverStartTime,
      deadline,
    };
    ctx.broadcast("round:play", publicPayload);
    timer = setTimeout(complete, cfg.receiveTimeMs + 200);
  }

  function maybeComplete() {
    // Tous les couples parieurs + le Récepteur ont agi → on termine.
    const betsExpected = ctx.couples.length - 1; // tous sauf le couple actif
    if (phase === "reception" && cursor !== null && bets.size >= betsExpected) complete();
  }

  function complete() {
    if (phase === "over") return;
    phase = "over";
    clearTimer();
    ctx.requestComplete();
  }

  return {
    mode: "wavelength",
    rule: "Un de vous voit une cible cachée et n'a qu'UN mot pour y guider l'autre. Les autres couples parient sur le résultat.",
    maxDurationMs: cfg.clueTimeMs + cfg.receiveTimeMs + 1000,

    startPlay() {
      phase = "clue";
      serverStartTime = ctx.clock.now();
      deadline = serverStartTime + cfg.clueTimeMs;
      // Payload public SANS la cible (le Récepteur et les parieurs ne la voient pas).
      publicPayload = {
        mode: "wavelength",
        phase: "clue",
        questionId: q.id,
        text: q.text,
        poleLeft: poles.poleLeft,
        poleRight: poles.poleRight,
        emitterPlayerId: emitterId,
        emitterCoupleId: activeCouple.id,
        clueMaxChars: cfg.clueMaxChars,
        serverStartTime,
        deadline,
      };
      ctx.broadcast("round:play", publicPayload);
      // L'Émetteur SEUL reçoit la cible (émis après le broadcast → écrase côté client).
      ctx.emitToPlayer(emitterId, "round:play", { ...publicPayload, target });
      // Si l'Émetteur ne donne pas d'indice à temps → on passe quand même.
      timer = setTimeout(startReception, cfg.clueTimeMs);
    },

    resync() {
      // Renvoie le payload public courant (sans cible : edge-case de reconnexion).
      return phase === "over" ? null : publicPayload;
    },

    collectAnswer(playerId, payload) {
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      if (phase === "clue") {
        if (playerId !== emitterId) return { accepted: false, reason: "not_emitter" };
        if (typeof payload.answer !== "string") return { accepted: false, reason: "need_value" };
        const text = payload.answer.trim().slice(0, cfg.clueMaxChars);
        if (!text) return { accepted: false, reason: "need_value" };
        clue = text;
        ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
        startReception();
        return { accepted: true };
      }
      if (phase === "reception") {
        if (playerId !== receiverId) return { accepted: false, reason: "not_receiver" };
        const n = Number(payload.answer);
        if (!Number.isFinite(n)) return { accepted: false, reason: "invalid_value" };
        cursor = Math.max(0, Math.min(100, n));
        ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
        maybeComplete();
        return { accepted: true };
      }
      return { accepted: false, reason: "wrong_phase" };
    },

    collectBet(playerId, payload) {
      if (phase !== "reception") return { accepted: false, reason: "wrong_phase" };
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      const coupleId = coupleOf(playerId);
      if (!coupleId) return { accepted: false, reason: "not_paired" };
      if (coupleId === activeCouple.id) return { accepted: false, reason: "active_cannot_bet" };
      const dir = payload.option as BetDirection;
      if (!DIRECTIONS.includes(dir)) return { accepted: false, reason: "invalid_direction" };
      bets.set(coupleId, dir);
      ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
      maybeComplete();
      return { accepted: true };
    },

    finishAndReveal(executeAt): { reveal: RevealPayload; fx: FxEvent[] } {
      const fx: FxEvent[] = [];
      const perCouple: RevealPayload["perCouple"] = [];
      const finalCursor = cursor ?? 50; // pas de réponse → milieu (0 pt probable)

      const res = scoreWavelength(
        {
          target,
          cursor: finalCursor,
          bullseyeRadius: cfg.bullseyeRadius,
          midRadius: cfg.midRadius,
          outerRadius: cfg.outerRadius,
          bets: [...bets.entries()].map(([coupleId, direction]) => ({ coupleId, direction })),
          emitterCoupleId: activeCouple.id,
          finaleMultiplier: ctx.finaleMultiplier,
        },
        cfg,
      );

      for (const couple of ctx.couples) {
        const isActive = couple.id === activeCouple.id;
        const delta = isActive ? res.emitterPoints : (res.betPoints.get(couple.id) ?? 0);
        couple.totalScore += delta;

        // Stat WavelengthAccuracy : distance du couple actif (plus bas = mieux).
        if (isActive) couple.stats.wavelengthDistances.push(res.distance);

        if (isActive && res.ring === "bullseye") {
          fx.push({ kind: "hearts", executeAt, coupleId: couple.id });
        }

        perCouple.push({
          coupleId: couple.id,
          name: couple.name,
          deltaScore: delta,
          detail: isActive
            ? { role: "active", ring: res.ring, target, cursor: finalCursor, clue: clue ?? null }
            : { role: "bettor", bet: bets.get(couple.id) ?? null, actualDirection: res.actualDirection },
        });
      }

      fx.push({ kind: "flash", executeAt, color: res.ring === "miss" ? "#e0245e" : "#1db954", durationMs: ctx.config.reveal.flashMs });

      return {
        reveal: {
          mode: "wavelength",
          questionId: q.id,
          executeAt,
          correctAnswer: String(target),
          perCouple,
        },
        fx,
      };
    },

    dispose() {
      clearTimer();
    },
  };
};
