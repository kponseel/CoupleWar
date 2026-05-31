import { useEffect } from "react";

/**
 * Wake Lock (§4.4 / §10.1) : garde l'écran allumé pendant le jeu, ré-acquiert
 * sur `visibilitychange` (iOS 16.4+). Fallback silencieux si non supporté.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if ("wakeLock" in navigator) {
          sentinel = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* refus / non supporté : on continue */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
