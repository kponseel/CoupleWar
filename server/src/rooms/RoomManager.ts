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

  constructor(io: Server, config: GameConfig, questionBank: QuestionBank, store?: RoomStore) {
    this.store = store ?? new MemoryRoomStore();
    this.deps = { io, config, questionBank };
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
  }
}
