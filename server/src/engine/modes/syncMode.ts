import type { FxEvent, PlayPayload, RevealPayload } from "@couplewar/shared";
import type { ModeFactory, RoundController, RoundContext } from "./types.js";
import { scoreSyncCouple, type SyncPlayerAnswer } from "../../scoring/sync.js";

/** Mode A — Sync (§5). Question QCM symétrique, scoring rapidité + synchro. */
export const createSyncMode: ModeFactory = (ctx: RoundContext): RoundController => {
  const cfg = ctx.config.sync;
  const q = ctx.question;
  const options = q.options ?? [];

  let serverStartTime = 0;
  let deadline = 0;
  const answers = new Map<string, { answer: string; responseTime: number }>();
  let timer: NodeJS.Timeout | null = null;
  let done = false;
  let payload: Extract<PlayPayload, { mode: "sync" }> | null = null;

  /** Joueurs appariés (dans un couple) — seuls eux jouent. */
  const coupledPlayerIds = new Set<string>(
    ctx.couples.flatMap((c) => c.playerIds),
  );

  function maybeComplete() {
    if (done) return;
    let allAnswered = true;
    for (const id of coupledPlayerIds) {
      if (!answers.has(id)) {
        allAnswered = false;
        break;
      }
    }
    if (allAnswered) complete();
  }

  function complete() {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    ctx.requestComplete();
  }

  return {
    mode: "sync",
    rule: "Répondez vite ET pareil que votre partenaire. Plus c'est rapide et synchrone, plus ça rapporte.",
    maxDurationMs: cfg.deadlineMs + 1000,

    startPlay() {
      serverStartTime = ctx.clock.now();
      deadline = serverStartTime + cfg.deadlineMs;
      payload = { mode: "sync", questionId: q.id, text: q.text, options, serverStartTime, deadline };
      ctx.broadcast("round:play", payload);
      timer = setTimeout(complete, cfg.deadlineMs + cfg.lateToleranceMs);
    },

    resync() {
      // On renvoie le payload pour réafficher la question ; le client gère son
      // propre état "answered" (et le serveur refuse les doublons de toute façon).
      return done ? null : payload;
    },

    collectAnswer(playerId, payload) {
      if (done) return { accepted: false, reason: "round_over" };
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      if (!coupledPlayerIds.has(playerId)) return { accepted: false, reason: "not_paired" };
      if (answers.has(playerId)) return { accepted: false, reason: "already_answered" };
      if (!options.includes(payload.answer)) return { accepted: false, reason: "invalid_option" };
      if (payload.clientSubmitTime > deadline + cfg.lateToleranceMs) {
        return { accepted: false, reason: "too_late" };
      }
      const responseTime = Math.max(0, payload.clientSubmitTime - serverStartTime);
      answers.set(playerId, { answer: payload.answer, responseTime });
      ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
      maybeComplete();
      return { accepted: true };
    },

    finishAndReveal(executeAt): { reveal: RevealPayload; fx: FxEvent[] } {
      const fx: FxEvent[] = [];
      const perCouple: RevealPayload["perCouple"] = [];

      for (const couple of ctx.couples) {
        const [pa, pb] = couple.playerIds;
        const aAns = answers.get(pa);
        const bAns = answers.get(pb);
        const a: SyncPlayerAnswer = {
          answer: aAns?.answer ?? null,
          responseTime: aAns?.responseTime ?? null,
        };
        const b: SyncPlayerAnswer = {
          answer: bAns?.answer ?? null,
          responseTime: bAns?.responseTime ?? null,
        };

        const streakMultiplierActive = couple.pendingSyncMultiplier;
        const res = scoreSyncCouple(
          {
            coupleId: couple.id,
            a,
            b,
            streakMultiplierActive,
            finaleMultiplier: ctx.finaleMultiplier,
          },
          cfg,
        );

        // Application autorité serveur : score + stats.
        couple.totalScore += res.deltaScore;
        couple.stats.syncTotal += 1;
        if (res.match) couple.stats.syncMatches += 1;
        if (res.latencyGap !== null) couple.stats.latencyGaps.push(res.latencyGap);
        if (res.bothAnswered && !res.match) couple.stats.divergences += 1;

        // Streak (§5.3 étape 4) — le multiplicateur hérité est consommé ce round.
        couple.pendingSyncMultiplier = false;
        if (res.match) {
          couple.syncStreak += 1;
          if (couple.syncStreak >= cfg.streakThreshold) {
            couple.pendingSyncMultiplier = true;
          }
        } else {
          couple.syncStreak = 0;
        }

        if (res.heartbeat) {
          fx.push({ kind: "heartbeat", executeAt, coupleId: couple.id });
          fx.push({ kind: "hearts", executeAt, coupleId: couple.id });
        }

        perCouple.push({
          coupleId: couple.id,
          name: couple.name,
          deltaScore: res.deltaScore,
          heartbeat: res.heartbeat,
          detail: {
            answerA: a.answer,
            answerB: b.answer,
            match: res.match,
            latencyGap: res.latencyGap,
            streakBonusApplied: streakMultiplierActive,
            streak: couple.syncStreak,
            inSymbiosis: couple.pendingSyncMultiplier,
          },
        });
      }

      // Flash collectif vert/rouge global (§10.2) : vert s'il y a au moins un match.
      const anyMatch = perCouple.some((p) => (p.detail as { match: boolean }).match);
      fx.push({ kind: "flash", executeAt, color: anyMatch ? "#1db954" : "#e0245e", durationMs: ctx.config.reveal.flashMs });

      return {
        reveal: { mode: "sync", questionId: q.id, executeAt, perCouple },
        fx,
      };
    },

    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
};
