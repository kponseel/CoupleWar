import type { CWSocket } from "./socket.js";

/**
 * Mini-NTP (§3.2). Estime l'offset entre `performance.now()` local et l'horloge
 * maître serveur. On garde la médiane de N échantillons (rejette les outliers).
 */
export async function calibrateClock(
  socket: CWSocket,
  samples = 5,
  intervalMs = 150,
): Promise<number> {
  const offsets: number[] = [];

  for (let i = 0; i < samples; i++) {
    const offset = await pingOnce(socket);
    if (offset !== null) offsets.push(offset);
    await sleep(intervalMs);
  }

  if (offsets.length === 0) return 0;
  offsets.sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  return offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
}

function pingOnce(socket: CWSocket): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 2000);
    socket.emit("clock:ping", (serverTime: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const t1 = performance.now();
      const rtt = t1 - t0;
      // offset = serverTime - (T0 + RTT/2)  → serverTimeEstimé = perfNow + offset
      resolve(serverTime - (t0 + rtt / 2));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
