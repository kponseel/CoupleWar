/**
 * Horloge maître serveur (§3). Le serveur est l'unique référence temporelle :
 * tous les timestamps de scoring et tous les `executeAt` des FX synchronisés
 * (§10.2) sont exprimés dans cette horloge. Le client estime son offset via le
 * mini-NTP (§3.2) et convertit localement.
 */
export class Clock {
  /** Temps maître en ms. Date.now() suffit : monotone-croissant à l'échelle d'une partie. */
  now(): number {
    return Date.now();
  }
}

export const clock = new Clock();
