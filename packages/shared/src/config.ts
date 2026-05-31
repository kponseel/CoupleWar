import { z } from "zod";

/**
 * Schéma de la config centralisée (§11 de la spec). Le serveur charge le JSONC,
 * le valide ici, et c'est l'unique source des valeurs chiffrées du jeu.
 */
const intensitySchema = z.enum(["light", "medium", "deep"]);

export const gameConfigSchema = z.object({
  configVersion: z.string(),
  room: z.object({
    minCouples: z.number().int().positive(),
    maxCouples: z.number().int().positive(),
    codeLength: z.number().int().positive(),
  }),
  sync: z.object({
    deadlineMs: z.number().positive(),
    baseMin: z.number().nonnegative(),
    baseMax: z.number().positive(),
    matchMultiplier: z.number().positive(),
    heartbeatGapMs: z.number().nonnegative(),
    heartbeatBonus: z.number().nonnegative(),
    streakThreshold: z.number().int().positive(),
    streakMultiplier: z.number().positive(),
    lateToleranceMs: z.number().nonnegative(),
  }),
  wavelength: z.object({
    clueTimeMs: z.number().positive(),
    receiveTimeMs: z.number().positive(),
    bullseyePts: z.number(),
    midPts: z.number(),
    outerPts: z.number(),
    betCorrectPts: z.number(),
    betBullseyePts: z.number(),
    emojiGridSize: z.number().int().positive(),
    // Demi-largeurs des anneaux (échelle 0..100) autour de la cible (§6.2).
    bullseyeRadius: z.number().positive(),
    midRadius: z.number().positive(),
    outerRadius: z.number().positive(),
    clueMaxChars: z.number().int().positive(),
  }),
  auction: z.object({
    answerTimeMs: z.number().positive(),
    betTimeMs: z.number().positive(),
    tokensPerRound: z.number().int().positive(),
    minBet: z.number().int().positive(),
    maxBet: z.number().int().positive(),
    winMultiplier: z.number().positive(),
    tokenToPoints: z.number().positive(),
    perfectGuessBonus: z.number().nonnegative(),
    freeTextMaxChars: z.number().int().positive(),
  }),
  mime: z.object({
    doodleTimeMs: z.number().positive(),
    headsupTimeMs: z.number().positive(),
    headsupCluesMax: z.number().int().positive(),
    emojiCooldownMs: z.number().nonnegative(), // 0 = pas de cooldown (tests)
    emojiPoolSize: z.number().int().positive(),
    emojiHandSize: z.number().int().positive(),
    matchPts: z.number(),
    socialVoteBonus: z.number(),
    headsupPerWordPts: z.number(),
    otherCoupleGuessPts: z.number(),
    cameraClipSec: z.number(),
    // D3 (canal d'emojis) :
    emojiRoundTimeMs: z.number().positive(),
    guessMaxChars: z.number().int().positive(),
  }),
  results: z.object({
    compatFloor: z.number().min(0).max(100),
    weights: z.object({
      sync: z.number(),
      prediction: z.number(),
      wavelength: z.number(),
      divergence: z.number(),
    }),
  }),
  tone: z.object({
    maxDeepQuestionsPerGame: z.number().int().nonnegative(),
    funToVulnerableRatio: z.string(),
  }),
  reveal: z.object({
    drumrollMs: z.number().nonnegative(),
    freezeMs: z.number().nonnegative(),
    flashMs: z.number().nonnegative(),
  }),
  finale: z.object({
    scoreMultiplier: z.number().positive(),
  }),
  catchUp: z.object({
    enabled: z.boolean(),
    leaderPenalty: z.number().positive(),
    lastBonus: z.number().positive(),
    minCouples: z.number().int().positive(),
  }),
  clock: z.object({
    samples: z.number().int().positive(),
    sampleIntervalMs: z.number().positive(),
  }),
  network: z.object({
    reconnectGraceMs: z.number().nonnegative(),
  }),
  roundPlan: z
    .array(
      z.object({
        mode: z.string(),
        intensityMax: intensitySchema,
        finale: z.boolean().optional(),
      }),
    )
    .min(1),
  introMs: z.number().nonnegative(),
  revealHoldMs: z.number().nonnegative(),
  interludeMs: z.number().nonnegative(),
  leaderboardRowPauseMs: z.number().nonnegative(),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type RoundPlanEntry = GameConfig["roundPlan"][number];
