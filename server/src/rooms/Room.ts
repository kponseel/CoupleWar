import type { Server } from "socket.io";
import type {
  CoupleResult,
  GameConfig,
  GameMode,
  LeaderboardEntry,
  RevealPayload,
  RoundPlanEntry,
  ServerToClient,
} from "@couplewar/shared";
import { clock } from "../engine/clock.js";
import { QuestionBank } from "../content/questions.js";
import { generateCoupleNames, sanitizeCoupleName } from "../content/coupleNames.js";
import { getResultsContent } from "../content/results.js";
import { computeResults } from "../scoring/results.js";
import { computeCatchUp } from "../scoring/catchUp.js";
import {
  buildSnapshot,
  emptyStats,
  toCoupleView,
  type Couple,
  type Player,
  type RoomData,
} from "./model.js";
import { makeCoupleJoinCode, makeId } from "../util/ids.js";
import type { ModeFactory, RoundContext, RoundController } from "../engine/modes/types.js";
import { createSyncMode } from "../engine/modes/syncMode.js";
import { createAuctionMode } from "../engine/modes/auctionMode.js";
import { createWavelengthMode } from "../engine/modes/wavelengthMode.js";
import { createMimeEmojiMode } from "../engine/modes/mimeEmojiMode.js";

const MODE_FACTORIES: Partial<Record<GameMode, ModeFactory>> = {
  sync: createSyncMode,
  auction: createAuctionMode,
  wavelength: createWavelengthMode,
  mime_d3: createMimeEmojiMode,
};

export interface RoomDeps {
  io: Server;
  config: GameConfig;
  questionBank: QuestionBank;
}

/** Une room = une partie. Machine à états §2 + orchestration du moteur générique. */
export class Room {
  readonly data: RoomData;
  private io: Server;
  private config: GameConfig;
  private bank: QuestionBank;

  // Pilotage de partie
  private roundPlan: RoundPlanEntry[] = [];
  private deepBudget = 0;
  private usedQuestionIds = new Set<string>();
  private modeCounters = new Map<GameMode, number>();
  private controller: RoundController | null = null;
  private currentQuestionId: string | null = null;
  private roundCompleted = false;
  private timers = new Set<NodeJS.Timeout>();
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  // Multiplicateurs anti-décrochage (§10.3) à appliquer au round courant, par coupleId.
  private catchUpMultipliers = new Map<string, number>();

  // Derniers événements transitoires, pour re-synchroniser une reconnexion (§14).
  private lastIntro: Parameters<ServerToClient["round:intro"]>[0] | null = null;
  private lastReveal: RevealPayload | null = null;
  private lastLeaderboard: Parameters<ServerToClient["leaderboard:update"]>[0] | null = null;
  private lastResults: CoupleResult[] | null = null;

  constructor(roomCode: string, deps: RoomDeps) {
    this.io = deps.io;
    this.config = deps.config;
    this.bank = deps.questionBank;
    this.data = {
      roomCode,
      configVersion: this.config.configVersion,
      minCouples: this.config.room.minCouples,
      maxCouples: this.config.room.maxCouples,
      state: "LOBBY",
      currentRound: 0,
      totalRounds: this.config.roundPlan.length,
      currentMode: null,
      isFinale: false,
      solo: false,
      players: new Map(),
      couples: new Map(),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers d'émission
  // -------------------------------------------------------------------------
  private setTimer(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private emit<K extends keyof ServerToClient>(ev: K, ...args: Parameters<ServerToClient[K]>): void {
    this.io.to(this.data.roomCode).emit(ev, ...args);
  }
  private emitTo<K extends keyof ServerToClient>(
    socketId: string | null,
    ev: K,
    ...args: Parameters<ServerToClient[K]>
  ): void {
    if (socketId) this.io.to(socketId).emit(ev, ...args);
  }
  private emitToPlayer<K extends keyof ServerToClient>(
    playerId: string,
    ev: K,
    ...args: Parameters<ServerToClient[K]>
  ): void {
    this.emitTo(this.data.players.get(playerId)?.socketId ?? null, ev, ...args);
  }
  private broadcastSnapshot(): void {
    this.emit("room:state", buildSnapshot(this.data));
  }

  // -------------------------------------------------------------------------
  // Lobby / connexion
  // -------------------------------------------------------------------------
  get code(): string {
    return this.data.roomCode;
  }
  get isEmpty(): boolean {
    return [...this.data.players.values()].every((p) => !p.connected);
  }

  addPlayer(socketId: string, name: string, isHost: boolean): Player {
    const player: Player = {
      id: makeId("p"),
      name: name.trim().slice(0, 24) || (isHost ? "Host" : "Joueur"),
      coupleId: null,
      socketId,
      connected: true,
      isHost,
      ready: false,
      disconnectedAt: null,
    };
    this.data.players.set(player.id, player);
    this.broadcastSnapshot();
    return player;
  }

  /** Reconnexion d'un joueur connu (§14). */
  resumePlayer(playerId: string, socketId: string): Player | null {
    const p = this.data.players.get(playerId);
    if (!p) return null;
    const dt = this.disconnectTimers.get(playerId);
    if (dt) {
      clearTimeout(dt);
      this.disconnectTimers.delete(playerId);
    }
    p.socketId = socketId;
    p.connected = true;
    p.disconnectedAt = null;
    this.broadcastSnapshot();
    this.resyncPlayer(p.id, socketId);
    return p;
  }

  /** Renvoie l'état transitoire en cours au seul socket qui se reconnecte (§14). */
  private resyncPlayer(_playerId: string, socketId: string): void {
    switch (this.data.state) {
      case "ROUND_INTRO":
        if (this.lastIntro) this.emitTo(socketId, "round:intro", this.lastIntro);
        break;
      case "ROUND_PLAY":
      case "FINALE": {
        const play = this.controller?.resync() ?? null;
        if (play) this.emitTo(socketId, "round:play", play);
        break;
      }
      case "ROUND_REVEAL":
        if (this.lastReveal) this.emitTo(socketId, "round:reveal", this.lastReveal);
        break;
      case "INTERLUDE":
        if (this.lastLeaderboard) this.emitTo(socketId, "leaderboard:update", this.lastLeaderboard);
        break;
      case "RESULTS":
      case "END":
        if (this.lastResults) this.emitTo(socketId, "results:final", { results: this.lastResults });
        break;
      default:
        break;
    }
  }

  handleDisconnect(playerId: string): void {
    const p = this.data.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.disconnectedAt = clock.now();
    this.broadcastSnapshot();
    // Fenêtre de grâce : si toujours absent et partie en LOBBY/PAIRING, on retire.
    const grace = this.config.network.reconnectGraceMs;
    const t = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      const still = this.data.players.get(playerId);
      if (still && !still.connected && (this.data.state === "LOBBY" || this.data.state === "PAIRING")) {
        this.removePlayer(playerId);
      }
    }, grace);
    this.disconnectTimers.set(playerId, t);
  }

  private removePlayer(playerId: string): void {
    const p = this.data.players.get(playerId);
    if (!p) return;
    if (p.coupleId) {
      const couple = this.data.couples.get(p.coupleId);
      if (couple) {
        couple.playerIds = couple.playerIds.filter((id) => id !== playerId);
        if (couple.playerIds.length === 0) this.data.couples.delete(couple.id);
      }
    }
    this.data.players.delete(playerId);
    this.broadcastSnapshot();
  }

  // -------------------------------------------------------------------------
  // Pairing (§4)
  // -------------------------------------------------------------------------
  createCouple(playerId: string): { coupleId: string; joinCode: string; names: string[] } | { error: string } {
    const p = this.data.players.get(playerId);
    if (!p) return { error: "unknown_player" };
    if (p.coupleId) return { error: "already_paired" };
    if (this.data.couples.size >= this.config.room.maxCouples) return { error: "room_full" };
    const names = generateCoupleNames(3);
    const couple: Couple = {
      id: makeId("c"),
      name: names[0],
      playerIds: [playerId],
      joinCode: makeCoupleJoinCode(),
      totalScore: 0,
      stats: emptyStats(),
      syncStreak: 0,
      pendingSyncMultiplier: false,
      handicap: null,
    };
    this.data.couples.set(couple.id, couple);
    p.coupleId = couple.id;
    this.broadcastSnapshot();
    return { coupleId: couple.id, joinCode: couple.joinCode!, names };
  }

  joinCouple(playerId: string, joinCode: string): { coupleId: string } | { error: string } {
    const p = this.data.players.get(playerId);
    if (!p) return { error: "unknown_player" };
    if (p.coupleId) return { error: "already_paired" };
    const couple = [...this.data.couples.values()].find((c) => c.joinCode === joinCode);
    if (!couple) return { error: "bad_code" };
    if (couple.playerIds.length >= 2) return { error: "couple_full" };
    couple.playerIds.push(playerId);
    couple.joinCode = null; // couple complet, le code ne sert plus
    p.coupleId = couple.id;
    this.broadcastSnapshot();
    return { coupleId: couple.id };
  }

  rerollName(coupleId: string): { names: string[] } | { error: string } {
    const couple = this.data.couples.get(coupleId);
    if (!couple) return { error: "unknown_couple" };
    const names = generateCoupleNames(3);
    couple.name = names[0];
    this.broadcastSnapshot();
    return { names };
  }

  setCoupleName(coupleId: string, name: string): { name: string } | { error: string } {
    const couple = this.data.couples.get(coupleId);
    if (!couple) return { error: "unknown_couple" };
    couple.name = sanitizeCoupleName(name);
    this.broadcastSnapshot();
    return { name: couple.name };
  }

  setReady(playerId: string, ready: boolean): void {
    const p = this.data.players.get(playerId);
    if (!p) return;
    p.ready = ready;
    if (this.data.state === "LOBBY" && [...this.data.players.values()].some((x) => x.coupleId)) {
      this.data.state = "PAIRING";
    }
    this.broadcastSnapshot();
  }

  // -------------------------------------------------------------------------
  // Démarrage de partie + state machine
  // -------------------------------------------------------------------------
  /**
   * @param solo Mode solo/practice (§dev) : autorise le démarrage avec 1 seul
   * couple (au lieu de minCouples). Les modes inter-couples dégradent proprement
   * (Enchères = le Devineur parie ; Wavelength = pas de parieurs).
   */
  canStart(solo = false): { ok: true } | { ok: false; reason: string } {
    const couples = [...this.data.couples.values()];
    const min = solo ? 1 : this.config.room.minCouples;
    if (couples.length < min) return { ok: false, reason: solo ? "need_one_couple" : "not_enough_couples" };
    if (couples.length > this.config.room.maxCouples) return { ok: false, reason: "too_many_couples" };
    if (couples.some((c) => c.playerIds.length !== 2)) return { ok: false, reason: "incomplete_couple" };
    // tous les modes du plan doivent être branchés
    if (this.config.roundPlan.some((r) => !MODE_FACTORIES[r.mode as GameMode])) {
      return { ok: false, reason: "unsupported_mode_in_plan" };
    }
    return { ok: true };
  }

  startGame(solo = false): { ok: boolean; reason?: string } {
    const check = this.canStart(solo);
    if (!check.ok) return { ok: false, reason: check.reason };
    this.data.solo = solo;
    this.roundPlan = this.config.roundPlan;
    this.deepBudget = this.config.tone.maxDeepQuestionsPerGame;
    this.usedQuestionIds.clear();
    this.modeCounters.clear();
    this.catchUpMultipliers.clear();
    this.data.currentRound = 0;
    this.nextRound();
    return { ok: true };
  }

  private nextRound(): void {
    this.disposeController();
    this.data.currentRound += 1;
    if (this.data.currentRound > this.data.totalRounds) {
      this.goResults();
      return;
    }
    const plan = this.roundPlan[this.data.currentRound - 1];
    const mode = plan.mode as GameMode;
    this.data.currentMode = mode;
    this.data.isFinale = plan.finale === true;
    this.data.state = "ROUND_INTRO";

    const factory = MODE_FACTORIES[mode];
    if (!factory) {
      // garde-fou : ne devrait pas arriver (canStart le vérifie)
      this.goResults();
      return;
    }

    const question = this.bank.pick(mode, plan.intensityMax, this.deepBudget, this.usedQuestionIds);
    if (!question) {
      this.goResults();
      return;
    }
    this.usedQuestionIds.add(question.id);
    if (question.intensity === "deep") this.deepBudget -= 1;

    const modeRoundIndex = this.modeCounters.get(mode) ?? 0;
    this.modeCounters.set(mode, modeRoundIndex + 1);

    const finaleMultiplier = this.data.isFinale ? this.config.finale.scoreMultiplier : 1;

    this.broadcastSnapshot();
    const introExecuteAt = clock.now() + 200;
    this.emit("round:intro", {
      round: this.data.currentRound,
      mode,
      rule: "", // rempli après création du contrôleur
      isFinale: this.data.isFinale,
      executeAt: introExecuteAt,
    });

    // Crée le contrôleur (pour connaître sa règle), mais ne démarre qu'après l'intro.
    const ctx: RoundContext = {
      config: this.config,
      question,
      isFinale: this.data.isFinale,
      finaleMultiplier,
      clock,
      couples: [...this.data.couples.values()],
      playersById: this.data.players,
      modeRoundIndex,
      broadcast: (ev, ...args) => (this.emit as (e: string, ...a: unknown[]) => void)(ev, ...args),
      emitToPlayer: (pid, ev, ...args) =>
        (this.emitToPlayer as (p: string, e: string, ...a: unknown[]) => void)(pid, ev, ...args),
      emitToCouple: (cid, ev, ...args) => {
        const couple = this.data.couples.get(cid);
        couple?.playerIds.forEach((pid) =>
          (this.emitToPlayer as (p: string, e: string, ...a: unknown[]) => void)(pid, ev, ...args),
        );
      },
      requestComplete: () => this.onRoundComplete(),
    };
    this.controller = factory(ctx);
    this.roundCompleted = false;

    // Renvoie l'intro avec la vraie règle.
    this.lastIntro = {
      round: this.data.currentRound,
      mode,
      rule: this.controller.rule,
      isFinale: this.data.isFinale,
      executeAt: introExecuteAt,
    };
    this.emit("round:intro", this.lastIntro);

    this.setTimer(() => this.startPlay(), this.config.introMs);
  }

  private startPlay(): void {
    if (!this.controller) return;
    this.data.state = "ROUND_PLAY";
    this.broadcastSnapshot();
    this.controller.startPlay();
    // Filet de sécurité : force la fin si le contrôleur ne complète pas.
    this.setTimer(() => this.onRoundComplete(), this.controller.maxDurationMs + 2000);
  }

  private onRoundComplete(): void {
    if (this.roundCompleted || !this.controller) return;
    this.roundCompleted = true;
    this.clearTimers();

    this.data.state = "ROUND_REVEAL";
    const lead = this.config.reveal.drumrollMs + this.config.reveal.freezeMs + 200;
    const executeAt = clock.now() + lead;

    // Anti-décrochage (§10.3) : on capture les scores AVANT le scoring du round,
    // puis on applique le multiplicateur secret au delta gagné ce round.
    const preScores = new Map([...this.data.couples.values()].map((c) => [c.id, c.totalScore]));
    const { reveal, fx } = this.controller.finishAndReveal(executeAt);
    if (this.catchUpMultipliers.size > 0) {
      for (const couple of this.data.couples.values()) {
        const mult = this.catchUpMultipliers.get(couple.id) ?? 1;
        if (mult === 1) continue;
        const before = preScores.get(couple.id) ?? couple.totalScore;
        const delta = couple.totalScore - before;
        if (delta > 0) couple.totalScore = Math.round(before + delta * mult);
      }
      this.catchUpMultipliers.clear();
    }
    this.lastReveal = reveal;

    this.emit("round:reveal", reveal);
    for (const f of fx) this.emit("fx", f);
    for (const couple of this.data.couples.values()) {
      this.emit("score:update", { coupleId: couple.id, totalScore: couple.totalScore });
    }
    this.broadcastSnapshot();

    this.setTimer(() => this.goInterlude(), lead + this.config.revealHoldMs);
  }

  private goInterlude(): void {
    this.disposeController();
    this.data.state = "INTERLUDE";
    const entries = this.buildLeaderboard();
    const topReserved = this.data.currentRound < this.data.totalRounds; // top3 réservé à la FINALE (§10.3)
    this.lastLeaderboard = { entries, rowPauseMs: this.config.leaderboardRowPauseMs, topReserved };
    this.emit("leaderboard:update", this.lastLeaderboard);
    this.prepareCatchUp();
    this.broadcastSnapshot();
    this.setTimer(() => this.nextRound(), this.config.interludeMs);
  }

  /**
   * Anti-décrochage (§10.3) : prépare le handicap/bonus secret du PROCHAIN round
   * d'après le classement courant. Sauté si le prochain round est la FINALE
   * (qui a déjà son inflation ×2.5). Le libellé `handicap` est posé sur chaque
   * couple pour l'afficher (« handicap secret » / « bonus secret »).
   */
  private prepareCatchUp(): void {
    this.catchUpMultipliers.clear();
    for (const c of this.data.couples.values()) c.handicap = null;

    const nextPlan = this.roundPlan[this.data.currentRound]; // 0-based index = round suivant
    if (!nextPlan || nextPlan.finale === true) return;

    const standings = [...this.data.couples.values()].map((c) => ({ coupleId: c.id, totalScore: c.totalScore }));
    const assignments = computeCatchUp(standings, this.config.catchUp);
    for (const a of assignments) {
      if (a.kind === null) continue;
      this.catchUpMultipliers.set(a.coupleId, a.multiplier);
      const couple = this.data.couples.get(a.coupleId);
      if (couple) couple.handicap = a.kind === "handicap" ? "handicap_secret" : "bonus_secret";
    }
  }

  private buildLeaderboard(): LeaderboardEntry[] {
    const couples = [...this.data.couples.values()];
    const sorted = couples.sort((a, b) => b.totalScore - a.totalScore);
    return sorted.map((c, i) => ({
      coupleId: c.id,
      name: c.name,
      totalScore: c.totalScore,
      syncRate: c.stats.syncTotal > 0 ? c.stats.syncMatches / c.stats.syncTotal : 0,
      rank: i + 1,
    }));
  }

  private goResults(): void {
    this.disposeController();
    this.clearTimers();
    this.data.state = "RESULTS";
    this.data.currentMode = null;
    const coupleViews = [...this.data.couples.values()].map(toCoupleView);
    const results = computeResults(coupleViews, this.config, getResultsContent());
    this.lastResults = results;
    this.emit("results:final", { results });
    this.broadcastSnapshot();
  }

  private disposeController(): void {
    this.controller?.dispose();
    this.controller = null;
  }

  // -------------------------------------------------------------------------
  // Contrôle hôte (anti-blocage §A3)
  // -------------------------------------------------------------------------
  /** L'hôte force la fin de la phase de jeu en cours (si un joueur bloque). */
  forceReveal(playerId: string): { forced: boolean; reason?: string } {
    const p = this.data.players.get(playerId);
    if (!p?.isHost) return { forced: false, reason: "not_host" };
    if ((this.data.state !== "ROUND_PLAY" && this.data.state !== "FINALE") || !this.controller) {
      return { forced: false, reason: "not_in_play" };
    }
    this.onRoundComplete();
    return { forced: true };
  }

  // -------------------------------------------------------------------------
  // Routage des actions de jeu
  // -------------------------------------------------------------------------
  submitAnswer(
    playerId: string,
    payload: { questionId: string; answer: string; clientSubmitTime: number },
  ): { accepted: boolean; reason?: string } {
    if (this.data.state !== "ROUND_PLAY" || !this.controller) {
      return { accepted: false, reason: "not_in_play" };
    }
    return this.controller.collectAnswer(playerId, payload);
  }

  submitBet(
    playerId: string,
    payload: { questionId: string; option: string; tokens: number },
  ): { accepted: boolean; reason?: string } {
    if (this.data.state !== "ROUND_PLAY" || !this.controller?.collectBet) {
      return { accepted: false, reason: "not_in_play" };
    }
    return this.controller.collectBet(playerId, payload);
  }

  submitEmoji(
    playerId: string,
    payload: { questionId: string; emoji: string },
  ): { accepted: boolean; reason?: string } {
    if (this.data.state !== "ROUND_PLAY" || !this.controller?.collectEmoji) {
      return { accepted: false, reason: "not_in_play" };
    }
    return this.controller.collectEmoji(playerId, payload);
  }

  dispose(): void {
    this.clearTimers();
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    this.disconnectTimers.clear();
    this.disposeController();
  }
}
