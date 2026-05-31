import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@couplewar/shared";
import { serverNow } from "../net/clock.js";
import { useStore } from "../store/store.js";

/** Overlay de flash collectif plein écran (§10.2). */
export function FlashOverlay() {
  const flash = useStore((s) => s.flash);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), flash.durationMs);
    return () => clearTimeout(t);
  }, [flash]);
  if (!flash || !visible) return null;
  return <div className="flash-overlay" style={{ background: flash.color }} />;
}

/** Toast d'erreur auto-disparaissant. */
export function ErrorToast() {
  const error = useStore((s) => s.error);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => set({ error: null }), 3500);
    return () => clearTimeout(t);
  }, [error, set]);
  if (!error) return null;
  return (
    <div className="toast" onClick={() => set({ error: null })}>
      ⚠️ {humanError(error)}
    </div>
  );
}

function humanError(code: string): string {
  const map: Record<string, string> = {
    room_not_found: "Room introuvable.",
    game_already_started: "La partie a déjà commencé.",
    not_enough_couples: "Il faut au moins 2 couples complets.",
    incomplete_couple: "Un couple n'a qu'un seul membre.",
    bad_code: "Code de couple invalide.",
    couple_full: "Ce couple est complet.",
    already_paired: "Tu es déjà en couple.",
    too_late: "Trop tard pour cette réponse !",
    cible_cannot_bet: "La Cible ne mise pas ce round.",
    not_host: "Seul l'hôte peut lancer la partie.",
    not_your_couple: "Action non autorisée sur ce couple.",
    connection_lost: "Connexion perdue. Vérifie ton réseau.",
    timeout: "Le serveur n'a pas répondu. Réessaie.",
    bad_payload: "Données invalides.",
  };
  return map[code] ?? code;
}

/** Barre de compte à rebours pilotée par l'horloge serveur (§1.3 : visuel only). */
export function Countdown({ start, deadline }: { start: number; deadline: number }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const total = Math.max(1, deadline - start);
    let raf = 0;
    const tick = () => {
      const remaining = deadline - serverNow();
      const p = Math.max(0, Math.min(100, (remaining / total) * 100));
      setPct(p);
      if (p > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, deadline]);
  const danger = pct < 33;
  return (
    <div className="countdown">
      <div className={`countdown-fill ${danger ? "danger" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Leaderboard avec reveal bottom-up (§10.3). */
export function Leaderboard({
  entries,
  rowPauseMs,
  topReserved,
}: {
  entries: LeaderboardEntry[];
  rowPauseMs: number;
  topReserved: boolean;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= entries.length) clearInterval(id);
    }, Math.max(120, rowPauseMs));
    return () => clearInterval(id);
  }, [entries, rowPauseMs]);

  // Bottom-up : on révèle de la dernière place vers la première.
  const revealedFromBottom = entries.length - shown;
  return (
    <div className="leaderboard">
      {entries.map((e, idx) => {
        const revealed = idx >= revealedFromBottom;
        const isTopHidden = topReserved && e.rank <= 3;
        const aura = e.rank === entries.length ? "aura-cold" : e.rank === 1 ? "aura-fire" : "";
        return (
          <div key={e.coupleId} className={`lb-row ${revealed ? "in" : ""} ${aura}`}>
            <span className="lb-rank">{e.rank}</span>
            <span className="lb-name">{isTopHidden ? "🔒 Réservé à la finale" : e.name}</span>
            <span className="lb-sync" title="SyncMètre">
              {Math.round(e.syncRate * 100)}%
            </span>
            <span className="lb-score">{isTopHidden ? "—" : e.totalScore.toLocaleString("fr-FR")}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      <p>{label}</p>
    </div>
  );
}

/** Bandeau de statut connexion (visible quand déconnecté/reconnexion). */
export function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  const role = useStore((s) => s.role);
  if (connected || !role) return null;
  return <div className="conn-banner">📡 Reconnexion…</div>;
}
