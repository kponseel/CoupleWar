import type { FxEvent, PlayPayload, RevealPayload } from "@couplewar/shared";
import type { ModeFactory, RoundController, RoundContext } from "./types.js";
import { scoreAuction, type AuctionBet } from "../../scoring/auction.js";
import { shuffle } from "../../util/shuffle.js";

const OTHER_OPTION = "Autre…";

/** Mode C — Enchères (§7). Cible répond en secret, les autres misent des jetons. */
export const createAuctionMode: ModeFactory = (ctx: RoundContext): RoundController => {
  const cfg = ctx.config.auction;
  const q = ctx.question;
  const baseOptions = q.options ?? [];

  // Rotation du couple Cible et du Cible/Devineur au sein du couple (§7.3).
  const targetCouple = ctx.couples[ctx.modeRoundIndex % ctx.couples.length];
  const cibleIndex = ctx.modeRoundIndex % 2; // alterne le membre Cible
  const ciblePlayerId = targetCouple.playerIds[cibleIndex] ?? targetCouple.playerIds[0];
  const devineurPlayerId =
    targetCouple.playerIds.find((p) => p !== ciblePlayerId) ?? targetCouple.playerIds[0];

  let phase: "answer" | "bet" | "over" = "answer";
  let serverStartTime = 0;
  let deadline = 0;
  let targetAnswer: string | null = null;
  let bettableOptions: string[] = [];
  const bets = new Map<string, AuctionBet>(); // par coupleId
  let timer: NodeJS.Timeout | null = null;
  let payload: PlayPayload | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function startBetPhase() {
    if (phase !== "answer") return;
    phase = "bet";
    clearTimer();

    // Options bettables : les 4 d'origine + la réponse libre du Cible si hors-liste.
    const opts = [...baseOptions];
    if (targetAnswer && !opts.includes(targetAnswer)) opts.push(targetAnswer);
    bettableOptions = shuffle(opts);

    serverStartTime = ctx.clock.now();
    deadline = serverStartTime + cfg.betTimeMs;
    payload = {
      mode: "auction",
      phase: "bet",
      questionId: q.id,
      text: q.text,
      options: bettableOptions,
      targetCoupleId: targetCouple.id,
      tokensPerRound: cfg.tokensPerRound,
      minBet: cfg.minBet,
      maxBet: cfg.maxBet,
      serverStartTime,
      deadline,
    };
    ctx.broadcast("round:play", payload);
    timer = setTimeout(complete, cfg.betTimeMs + 200);
  }

  function eligibleCoupleCount(): number {
    return ctx.couples.length; // chaque couple mise une fois (la Cible via le Devineur)
  }

  function maybeComplete() {
    if (phase === "bet" && bets.size >= eligibleCoupleCount()) complete();
  }

  function complete() {
    if (phase === "over") return;
    phase = "over";
    clearTimer();
    ctx.requestComplete();
  }

  function coupleOf(playerId: string): string | null {
    const p = ctx.playersById.get(playerId);
    return p?.coupleId ?? null;
  }

  return {
    mode: "auction",
    rule: "Le Cible répond en secret. Son/sa partenaire et les autres couples misent leurs jetons sur la vraie réponse. Bien parier = gros points.",
    maxDurationMs: cfg.answerTimeMs + cfg.betTimeMs + 1000,

    startPlay() {
      phase = "answer";
      serverStartTime = ctx.clock.now();
      deadline = serverStartTime + cfg.answerTimeMs;
      const options = [...baseOptions, OTHER_OPTION];
      payload = {
        mode: "auction",
        phase: "answer",
        questionId: q.id,
        text: q.text,
        options,
        targetPlayerId: ciblePlayerId,
        serverStartTime,
        deadline,
      };
      ctx.broadcast("round:play", payload);
      // Si le Cible ne répond pas dans les temps → on passe quand même aux enchères.
      timer = setTimeout(startBetPhase, cfg.answerTimeMs);
    },

    resync() {
      return phase === "over" ? null : payload;
    },

    collectAnswer(playerId, payload) {
      if (phase !== "answer") return { accepted: false, reason: "wrong_phase" };
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      if (playerId !== ciblePlayerId) return { accepted: false, reason: "not_target" };
      if (typeof payload.answer !== "string") return { accepted: false, reason: "need_value" };
      // Réponse = une option pré-générée OU texte libre (≤ freeTextMaxChars).
      let answer = payload.answer.trim();
      if (answer === OTHER_OPTION || answer.length === 0) {
        return { accepted: false, reason: "need_value" };
      }
      if (!baseOptions.includes(answer)) {
        answer = answer.slice(0, cfg.freeTextMaxChars);
      }
      targetAnswer = answer;
      ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
      startBetPhase(); // on enchaîne dès que le Cible a répondu
      return { accepted: true };
    },

    collectBet(playerId, payload) {
      if (phase !== "bet") return { accepted: false, reason: "wrong_phase" };
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      const coupleId = coupleOf(playerId);
      if (!coupleId) return { accepted: false, reason: "not_paired" };
      // La Cible ne mise pas ; seul le Devineur mise pour le couple Cible (§7.3).
      if (coupleId === targetCouple.id && playerId !== devineurPlayerId) {
        return { accepted: false, reason: "cible_cannot_bet" };
      }
      if (typeof payload.option !== "string" || !bettableOptions.includes(payload.option)) {
        return { accepted: false, reason: "invalid_option" };
      }
      // tokens doit être un entier fini dans les bornes, sinon NaN corrompt le score.
      if (!Number.isFinite(payload.tokens)) {
        return { accepted: false, reason: "invalid_tokens" };
      }
      const tokens = Math.round(payload.tokens);
      if (tokens < cfg.minBet || tokens > cfg.maxBet) {
        return { accepted: false, reason: "invalid_tokens" };
      }
      bets.set(coupleId, {
        coupleId,
        option: payload.option,
        tokens,
        isDevineur: coupleId === targetCouple.id,
      });
      ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
      maybeComplete();
      return { accepted: true };
    },

    finishAndReveal(executeAt): { reveal: RevealPayload; fx: FxEvent[] } {
      const fx: FxEvent[] = [];
      const perCouple: RevealPayload["perCouple"] = [];

      const results =
        targetAnswer === null
          ? [] // pas de réponse Cible : aucune mise gagnante
          : scoreAuction(
              {
                targetCoupleId: targetCouple.id,
                correctAnswer: targetAnswer,
                bets: [...bets.values()],
                finaleMultiplier: ctx.finaleMultiplier,
              },
              cfg,
            );
      const resById = new Map(results.map((r) => [r.coupleId, r]));

      for (const couple of ctx.couples) {
        const bet = bets.get(couple.id);
        const res = resById.get(couple.id);
        const delta = res?.deltaScore ?? 0;
        couple.totalScore += delta;

        // PredictionRate : alimentée par le Devineur (couple Cible) uniquement (§7.4).
        if (couple.id === targetCouple.id && targetAnswer !== null) {
          const correct = bet?.option === targetAnswer;
          couple.stats.predictionTotal += 1;
          if (correct) couple.stats.predictionCorrect += 1;
          const tags = q.tags ?? [];
          if (tags.includes("daily")) {
            couple.stats.predictionDailyTotal += 1;
            if (correct) couple.stats.predictionDailyCorrect += 1;
          }
          if (tags.includes("future") || tags.includes("desire")) {
            couple.stats.predictionFutureTotal += 1;
            if (correct) couple.stats.predictionFutureCorrect += 1;
          }
        }

        if (res?.perfectBonus) {
          fx.push({ kind: "hearts", executeAt, coupleId: couple.id });
        }

        perCouple.push({
          coupleId: couple.id,
          name: couple.name,
          deltaScore: delta,
          detail: {
            isTargetCouple: couple.id === targetCouple.id,
            bet: bet ? { option: bet.option, tokens: bet.tokens } : null,
            correct: res?.correct ?? false,
            perfectBonus: res?.perfectBonus ?? false,
          },
        });
      }

      // Drumroll + flash blanc théâtral (§7.2 phase 3 / §10.2).
      fx.push({ kind: "drumroll", executeAt: executeAt - ctx.config.reveal.drumrollMs, durationMs: ctx.config.reveal.drumrollMs });
      fx.push({ kind: "flash", executeAt, color: "#ffffff", durationMs: ctx.config.reveal.flashMs });

      return {
        reveal: {
          mode: "auction",
          questionId: q.id,
          executeAt,
          correctAnswer: targetAnswer ?? undefined,
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
