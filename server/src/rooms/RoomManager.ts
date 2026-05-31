import type { Server } from "socket.io";
import type { GameConfig } from "@couplewar/shared";
import { Room, type RoomDeps } from "./Room.js";
import { MemoryRoomStore, type RoomStore } from "./store.js";
import { QuestionBank } from "../content/questions.js";
import { makeRoomCode } from "../util/ids.js";

/** Registre des rooms. Crée des codes uniques, expose la résolution par code. */
export class RoomManager {
  private store: RoomStore;
  private deps: Omit<RoomDeps, "io"> & { io: Server };

  // Réclamation des rooms abandonnées (anti fuite mémoire en in-memory).
  // On note quand une room est devenue vide ; au-delà du délai, on la libère.
  private emptySince = new Map<string, number>();
  private reaper: NodeJS.Timeout | null = null;
  private readonly reapAfterMs: number;

  constructor(io: Server, config: GameConfig, questionBank: QuestionBank, store?: RoomStore) {
    this.store = store ?? new MemoryRoomStore();
    this.deps = { io, config, questionBank };
    // Une room vide est réclamée après ~2× la fenêtre de grâce de reconnexion.
    this.reapAfterMs = Math.max(60_000, config.network.reconnectGraceMs * 2);
  }

  /** Démarre le balayage périodique des rooms abandonnées. */
  startReaper(intervalMs = 60_000): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.reap(), intervalMs);
    this.reaper.unref?.(); // n'empêche pas le process de s'arrêter
  }

  stopReaper(): void {
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }

  private reap(): void {
    const now = Date.now();
    for (const room of this.store.all()) {
      if (room.isEmpty) {
        const since = this.emptySince.get(room.code) ?? now;
        if (!this.emptySince.has(room.code)) this.emptySince.set(room.code, now);
        if (now - since >= this.reapAfterMs) {
          this.removeRoom(room.code);
        }
      } else {
        // La room est de nouveau active : on annule le compte à rebours.
        this.emptySince.delete(room.code);
      }
    }
  }

  createRoom(): Room {
    let code = makeRoomCode(this.deps.config.room.codeLength);
    let guard = 0;
    while (this.store.has(code) && guard++ < 50) {
      code = makeRoomCode(this.deps.config.room.codeLength);
    }
    const room = new Room(code, this.deps);
    this.store.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.store.get(code.toUpperCase());
  }

  removeRoom(code: string): void {
    const room = this.store.get(code);
    room?.dispose();
    this.store.delete(code);
    this.emptySince.delete(code);
  }
}
