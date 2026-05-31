/**
 * Conversion horloge serveur ↔ locale via l'offset calibré (§3.2 / §10.2).
 * Un seul offset partagé pour toute l'app.
 */
let offset = 0;

export function setClockOffset(o: number): void {
  offset = o;
}

/** Temps serveur estimé maintenant. */
export function serverNow(): number {
  return performance.now() + offset;
}

/** Datation d'un événement local pour envoi au serveur (§3.3). */
export function clientSubmitTime(): number {
  return performance.now() + offset;
}

/** Délai local (ms) avant un `executeAt` exprimé en horloge serveur. */
export function delayUntil(executeAt: number): number {
  return executeAt - serverNow();
}
