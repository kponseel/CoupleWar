/**
 * Rate limiting par socket (token bucket). Protège le serveur d'un client qui
 * spamme des événements (boucle, script). Purement défensif : les limites sont
 * larges pour ne jamais gêner un joueur normal (taps, mises, pings d'horloge).
 */
export interface RateLimitOptions {
  /** Capacité du seau (rafale autorisée). */
  burst: number;
  /** Jetons régénérés par seconde (débit soutenu). */
  refillPerSec: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private readonly opts: RateLimitOptions) {
    this.tokens = opts.burst;
    this.last = Date.now();
  }
  /** Tente de consommer un jeton ; renvoie false si la limite est atteinte. */
  take(now = Date.now()): boolean {
    // Clamp à 0 : protège d'un `now` antérieur (test à horloge fixe / skew système).
    const elapsed = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.tokens = Math.min(this.opts.burst, this.tokens + elapsed * this.opts.refillPerSec);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Limites par défaut, généreuses pour le jeu, strictes contre l'abus. */
export const DEFAULT_RATE: RateLimitOptions = { burst: 30, refillPerSec: 15 };
