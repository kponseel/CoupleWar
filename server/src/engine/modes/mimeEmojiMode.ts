import type { FxEvent, PlayPayload, RevealPayload } from "@couplewar/shared";
import type { ModeFactory, RoundController, RoundContext } from "./types.js";
import { scoreMime, type MimeHit } from "../../scoring/mime.js";
import { fuzzyMatch } from "../../scoring/fuzzy.js";
import { dealEmojis } from "../../content/emojis.js";

/**
 * Mode D3 — Canal d'emojis (§8.3). Un couple actif : le Donneur voit le concept
 * + une main d'emojis, et les envoie un par un (cooldown serveur). Le Récepteur
 * et les autres couples devinent en texte libre (fuzzy match). Le Récepteur fait
 * marquer son couple ; un autre couple qui devine avant lui prend un chaos bonus.
 */
export const createMimeEmojiMode: ModeFactory = (ctx: RoundContext): RoundController => {
  const cfg = ctx.config.mime;
  const q = ctx.question;
  const secret = q.mime?.secret ?? q.text;
  const accept = q.mime?.accept ?? [];

  const activeCouple = ctx.couples[ctx.modeRoundIndex % ctx.couples.length];
  const giverId = activeCouple.playerIds[ctx.modeRoundIndex % 2] ?? activeCouple.playerIds[0];
  const receiverId = activeCouple.playerIds.find((p) => p !== giverId) ?? activeCouple.playerIds[0];

  let serverStartTime = 0;
  let deadline = 0;
  let done = false;
  let timer: NodeJS.Timeout | null = null;
  let lastEmojiAt = 0;
  let emojiCount = 0;
  const hand = dealEmojis(cfg.emojiHandSize);
  /** Payload public (sans secret ni main) — base du resync. */
  let publicPayload: Extract<PlayPayload, { mode: "mime_d3" }> | null = null;

  // Bonnes réponses, dans l'ordre d'arrivée (1re par couple seulement).
  const hits: MimeHit[] = [];
  const solvedCouples = new Set<string>();
  let order = 0;

  function coupleOf(playerId: string): string | null {
    return ctx.playersById.get(playerId)?.coupleId ?? null;
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function complete() {
    if (done) return;
    done = true;
    clearTimer();
    ctx.requestComplete();
  }

  function maybeComplete() {
    // Fin anticipée : le Récepteur a trouvé ET tous les autres couples aussi.
    if (solvedCouples.size >= ctx.couples.length) complete();
  }

  return {
    mode: "mime_d3",
    rule: "Le Donneur transmet un concept uniquement avec des emojis. Le/la partenaire (et les autres couples) devinent en tapant leur réponse.",
    maxDurationMs: cfg.emojiRoundTimeMs + 1000,

    startPlay() {
      serverStartTime = ctx.clock.now();
      deadline = serverStartTime + cfg.emojiRoundTimeMs;
      publicPayload = {
        mode: "mime_d3",
        phase: "play",
        questionId: q.id,
        text: q.text,
        giverPlayerId: giverId,
        giverCoupleId: activeCouple.id,
        receiverPlayerId: receiverId,
        emojiCooldownMs: cfg.emojiCooldownMs,
        guessMaxChars: cfg.guessMaxChars,
        serverStartTime,
        deadline,
      };
      // Émission par joueur : le Donneur SEUL reçoit secret + main (anti-fuite).
      for (const p of ctx.playersById.values()) {
        if (p.id === giverId) ctx.emitToPlayer(p.id, "round:play", { ...publicPayload, secret, hand });
        else ctx.emitToPlayer(p.id, "round:play", publicPayload);
      }
      timer = setTimeout(complete, cfg.emojiRoundTimeMs + 200);
    },

    resync() {
      return done ? null : publicPayload;
    },

    collectEmoji(playerId, payload) {
      if (done) return { accepted: false, reason: "round_over" };
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      if (playerId !== giverId) return { accepted: false, reason: "not_giver" };
      if (typeof payload.emoji !== "string" || !hand.includes(payload.emoji)) {
        return { accepted: false, reason: "invalid_emoji" };
      }
      // Cooldown serveur : 1 emoji toutes les emojiCooldownMs (§8.3).
      const now = ctx.clock.now();
      if (lastEmojiAt > 0 && now - lastEmojiAt < cfg.emojiCooldownMs) {
        return { accepted: false, reason: "cooldown" };
      }
      lastEmojiAt = now;
      // Broadcast à toute la room (l'emoji est public, pas le secret).
      ctx.broadcast("mime:emoji", { questionId: q.id, emoji: payload.emoji, index: emojiCount });
      emojiCount += 1;
      return { accepted: true };
    },

    collectAnswer(playerId, payload) {
      if (done) return { accepted: false, reason: "round_over" };
      if (payload.questionId !== q.id) return { accepted: false, reason: "wrong_question" };
      if (playerId === giverId) return { accepted: false, reason: "giver_cannot_guess" };
      const coupleId = coupleOf(playerId);
      if (!coupleId) return { accepted: false, reason: "not_paired" };
      if (solvedCouples.has(coupleId)) return { accepted: false, reason: "already_solved" };
      if (typeof payload.answer !== "string") return { accepted: false, reason: "need_value" };

      const correct = fuzzyMatch(payload.answer.slice(0, cfg.guessMaxChars), secret, accept);
      if (correct) {
        solvedCouples.add(coupleId);
        hits.push({ coupleId, isActiveCouple: coupleId === activeCouple.id, order: order++ });
        ctx.emitToPlayer(playerId, "answer:ack", { questionId: q.id, recorded: true });
        maybeComplete();
        return { accepted: true };
      }
      // Mauvaise réponse : acceptée (le joueur peut réessayer), mais pas de hit.
      return { accepted: true, reason: "wrong_guess" };
    },

    finishAndReveal(executeAt): { reveal: RevealPayload; fx: FxEvent[] } {
      const fx: FxEvent[] = [];
      const perCouple: RevealPayload["perCouple"] = [];

      const results = scoreMime(
        { activeCoupleId: activeCouple.id, hits, finaleMultiplier: ctx.finaleMultiplier },
        cfg,
      );
      const byId = new Map(results.map((r) => [r.coupleId, r]));

      for (const couple of ctx.couples) {
        const res = byId.get(couple.id);
        const delta = res?.deltaScore ?? 0;
        couple.totalScore += delta;

        const isActive = couple.id === activeCouple.id;
        if (isActive) {
          // Stat EmojiHits : alimentée pour le couple actif (transmis ou non).
          couple.stats.emojiTotal += 1;
          if (res?.transmitted) couple.stats.emojiHits += 1;
        }
        if (isActive && res?.transmitted) fx.push({ kind: "hearts", executeAt, coupleId: couple.id });

        perCouple.push({
          coupleId: couple.id,
          name: couple.name,
          deltaScore: delta,
          detail: isActive
            ? { role: "active", transmitted: res?.transmitted ?? false, secret }
            : { role: "guesser", correct: res?.correct ?? false },
        });
      }

      const anyHit = hits.length > 0;
      fx.push({ kind: "flash", executeAt, color: anyHit ? "#1db954" : "#e0245e", durationMs: ctx.config.reveal.flashMs });

      return {
        reveal: { mode: "mime_d3", questionId: q.id, executeAt, correctAnswer: secret, perCouple },
        fx,
      };
    },

    dispose() {
      clearTimer();
    },
  };
};
