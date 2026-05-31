import { io, type Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient } from "@couplewar/shared";

export type CWSocket = Socket<ServerToClient, ClientToServer>;

// En dev, Vite proxie /socket.io vers le serveur Node. En prod, same-origin.
// VITE_SERVER_URL permet de pointer un serveur distinct si besoin.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || undefined;

export const socket: CWSocket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});
