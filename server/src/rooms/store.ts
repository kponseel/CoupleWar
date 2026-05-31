import type { Room } from "./Room.js";

/**
 * Couche de persistance isolée (§ brief : in-memory au MVP, brancher Redis/PG
 * plus tard sans toucher au métier). Toute la logique de jeu passe par cette
 * interface ; seule l'implémentation change.
 */
export interface RoomStore {
  get(code: string): Room | undefined;
  set(code: string, room: Room): void;
  delete(code: string): void;
  has(code: string): boolean;
  all(): Room[];
}

/** Implémentation MVP : Map en mémoire. */
export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();
  get(code: string) {
    return this.rooms.get(code);
  }
  set(code: string, room: Room) {
    this.rooms.set(code, room);
  }
  delete(code: string) {
    this.rooms.delete(code);
  }
  has(code: string) {
    return this.rooms.has(code);
  }
  all() {
    return [...this.rooms.values()];
  }
}
