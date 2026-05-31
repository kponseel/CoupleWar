import type { ReactNode } from "react";
import type { PlayPayload, RevealPayload, RoomSnapshot } from "@couplewar/shared";
import { useStore } from "../store/store.js";
import { useWakeLock } from "../hooks/useWakeLock.js";
import { Countdown, Leaderboard } from "../components/common.js";

export function Host() {
  const snapshot = useStore((s) => s.snapshot);
  useWakeLock(true);
  if (!snapshot)
    return (
      <HostShell>
        <h1>Connexion…</h1>
      </HostShell>
    );

  switch (snapshot.state) {
    case "LOBBY":
    case "PAIRING":
      return <HostLobby snapshot={snapshot} />;
    case "ROUND_INTRO":
      return <HostIntro />;
    case "ROUND_PLAY":
    case "FINALE":
      return <HostPlay snapshot={snapshot} />;
    case "ROUND_REVEAL":
      return <HostReveal />;
    case "INTERLUDE":
      return <HostInterlude />;
    case "RESULTS":
    case "END":
      return <HostResults />;
    default:
      return (
        <HostShell>
          <h1>…</h1>
        </HostShell>
      );
  }
}

function HostShell({ children }: { children: ReactNode }) {
  return <div className="host-screen">{children}</div>;
}

function HostLobby({ snapshot }: { snapshot: RoomSnapshot }) {
  const startGame = useStore((s) => s.startGame);
  const couples = snapshot.couples;
  const canStart =
    couples.length >= snapshot.minCouples &&
    couples.length <= snapshot.maxCouples &&
    couples.every((c) => c.players.length === 2);
  const nameOf = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? "?";
  const unpaired = snapshot.players.filter((p) => !p.coupleId && !p.isHost);

  return (
    <HostShell>
      <div className="host-lobby">
        <div className="join-panel">
          <p className="join-label">Rejoignez sur vos téléphones avec le code</p>
          <div className="room-code">{snapshot.roomCode}</div>
          <ol className="how-to">
            <li>Ouvrez l'app sur votre téléphone</li>
            <li>
              Tapez le code <b>{snapshot.roomCode}</b> + votre prénom
            </li>
            <li>Formez votre couple, choisissez un nom</li>
            <li>Appuyez sur « Prêt·e » 💞</li>
          </ol>
        </div>
        <div className="couples-panel">
          <h2>Couples ({couples.length}/{snapshot.maxCouples})</h2>
          <div className="couples-list">
            {couples.map((c) => (
              <div key={c.id} className="couple-chip">
                <span className="couple-chip-name">{c.name}</span>
                <span className="couple-chip-players">
                  {c.players.map((p) => {
                    const ready = snapshot.players.find((pl) => pl.id === p)?.ready;
                    return (
                      <span key={p} className={`pl ${ready ? "ready" : ""}`}>
                        {nameOf(p)} {ready ? "✅" : ""}
                      </span>
                    );
                  })}
                  {c.players.length < 2 && <span className="pl waiting">…en attente</span>}
                </span>
              </div>
            ))}
            {couples.length === 0 && <p className="hint">En attente des premiers couples…</p>}
          </div>
          {unpaired.length > 0 && (
            <p className="hint">À apparier : {unpaired.map((p) => p.name).join(", ")}</p>
          )}
          <button className="btn btn-primary btn-xl" disabled={!canStart} onClick={() => void startGame()}>
            {canStart ? "🚀 Lancer la partie" : `En attente de ${snapshot.minCouples} couples complets…`}
          </button>
        </div>
      </div>
    </HostShell>
  );
}

function HostIntro() {
  const intro = useStore((s) => s.intro);
  if (!intro)
    return (
      <HostShell>
        <h1>…</h1>
      </HostShell>
    );
  return (
    <HostShell>
      <div className="host-intro">
        <div className="round-pill">{intro.isFinale ? "FINALE" : `Round ${intro.round}`}</div>
        <h1 className="mode-title">{intro.isFinale ? "🏁 GRANDE FINALE" : modeTitle(intro.mode)}</h1>
        <p className="mode-rule">{intro.rule}</p>
      </div>
    </HostShell>
  );
}

function HostPlay({ snapshot }: { snapshot: RoomSnapshot }) {
  const play = useStore((s) => s.play);
  const forceReveal = useStore((s) => s.forceReveal);
  if (!play)
    return (
      <HostShell>
        <h1>Préparez-vous…</h1>
      </HostShell>
    );
  return (
    <HostShell>
      <div className="host-play">
        <Countdown start={play.serverStartTime} deadline={play.deadline} />
        {renderHostPlay(play, snapshot)}
        {/* Anti-blocage : l'hôte peut révéler sans attendre les retardataires (§A3). */}
        <button className="btn btn-ghost host-force" onClick={() => void forceReveal()}>
          ⏭️ Révéler maintenant
        </button>
      </div>
    </HostShell>
  );
}

function renderHostPlay(play: PlayPayload, snapshot: RoomSnapshot) {
  if (play.mode === "sync") {
    return (
      <>
        <div className="phase-tag">SYNC · répondez vite et pareil</div>
        <h1 className="host-question">{play.text}</h1>
        <div className="host-options">
          {play.options.map((o, i) => (
            <div key={i} className={`host-opt opt-${i}`}>
              {o}
            </div>
          ))}
        </div>
        <p className="host-hint pulse">📱 Répondez sur vos téléphones…</p>
      </>
    );
  }
  if (play.mode === "auction" && play.phase === "answer") {
    const target = snapshot.players.find((p) => p.id === play.targetPlayerId);
    const couple = snapshot.couples.find((c) => c.id === target?.coupleId);
    return (
      <>
        <div className="phase-tag">ENCHÈRES · réponse secrète</div>
        <h1 className="host-question">{play.text}</h1>
        <p className="host-hint pulse">
          🤫 {target?.name} ({couple?.name}) répond en secret…
        </p>
      </>
    );
  }
  if (play.mode === "auction" && play.phase === "bet") {
    return (
      <>
        <div className="phase-tag">ENCHÈRES · misez vos jetons 💖</div>
        <h1 className="host-question">{play.text}</h1>
        <div className="host-options small">
          {play.options.map((o, i) => (
            <div key={i} className={`host-opt opt-${i}`}>
              {o}
            </div>
          ))}
        </div>
        <p className="host-hint pulse">📱 Placez vos mises…</p>
      </>
    );
  }
  if (play.mode === "wavelength" && play.phase === "clue") {
    const emitter = snapshot.players.find((p) => p.id === play.emitterPlayerId);
    return (
      <>
        <div className="phase-tag">WAVELENGTH · indice secret</div>
        <HostSpectrum left={play.poleLeft} right={play.poleRight} />
        <p className="host-hint pulse">🎯 {emitter?.name} cherche le mot parfait…</p>
      </>
    );
  }
  if (play.mode === "wavelength" && play.phase === "reception") {
    return (
      <>
        <div className="phase-tag">WAVELENGTH · à vous de viser</div>
        <h1 className="host-question">Indice : « {play.clue} »</h1>
        <HostSpectrum left={play.poleLeft} right={play.poleRight} />
        <p className="host-hint pulse">📱 Le Récepteur vise, les autres parient…</p>
      </>
    );
  }
  return null;
}

function HostSpectrum({ left, right }: { left: string; right: string }) {
  return (
    <div className="spectrum host-spectrum">
      <div className="spectrum-bar" />
      <div className="spectrum-poles">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function HostReveal() {
  const reveal = useStore((s) => s.reveal);
  if (!reveal)
    return (
      <HostShell>
        <h1>Révélation…</h1>
      </HostShell>
    );
  return (
    <HostShell>
      <div className="host-reveal">
        <h1>Révélation</h1>
        {reveal.correctAnswer && (
          <div className="correct-answer">
            Réponse : <b>{reveal.correctAnswer}</b>
          </div>
        )}
        <div className="reveal-list">
          {[...reveal.perCouple]
            .sort((a, b) => b.deltaScore - a.deltaScore)
            .map((pc) => (
              <div key={pc.coupleId} className={`reveal-row ${pc.heartbeat ? "heartbeat" : ""}`}>
                <span className="rv-name">{pc.name}</span>
                <span className="rv-detail">{detailText(reveal, pc)}</span>
                <span className={`rv-delta ${pc.deltaScore > 0 ? "pos" : ""}`}>
                  {pc.deltaScore > 0 ? "+" : ""}
                  {pc.deltaScore.toLocaleString("fr-FR")}
                </span>
              </div>
            ))}
        </div>
      </div>
    </HostShell>
  );
}

function detailText(reveal: RevealPayload, pc: RevealPayload["perCouple"][number]): string {
  const d = pc.detail as Record<string, unknown>;
  if (reveal.mode === "sync") {
    if (d.match) {
      const gap = d.latencyGap as number | null;
      return pc.heartbeat ? `💓 Match synchro (${gap}ms)` : `✅ Match${gap !== null ? ` (${gap}ms)` : ""}`;
    }
    return "❌ Réponses différentes";
  }
  if (reveal.mode === "auction") {
    if (d.isTargetCouple) {
      if (d.perfectBonus) return "🎯 Tu me connais par cœur ! (jackpot)";
      return d.correct ? "💘 Le/la Devineur·se a vu juste" : "🙈 Raté pour le couple Cible";
    }
    return d.correct ? "💰 Bon pari !" : "💸 Mise perdue";
  }
  if (reveal.mode === "wavelength") {
    if (d.role === "active") {
      const ring = d.ring as string;
      return ring === "bullseye"
        ? "🎯 En plein dans le mille !"
        : ring === "mid"
          ? "👍 Bien visé"
          : ring === "outer"
            ? "🆗 Pas loin"
            : "❌ Loin du compte";
    }
    return pc.deltaScore > 0 ? "✅ Bon pari !" : "🙈 Raté";
  }
  return "";
}

function HostInterlude() {
  const lb = useStore((s) => s.leaderboard);
  return (
    <HostShell>
      <div className="host-interlude">
        <h1>Classement</h1>
        {lb && <Leaderboard entries={lb.entries} rowPauseMs={lb.rowPauseMs} topReserved={lb.topReserved} />}
      </div>
    </HostShell>
  );
}

function HostResults() {
  const results = useStore((s) => s.results);
  if (!results)
    return (
      <HostShell>
        <h1>Calcul des titres…</h1>
      </HostShell>
    );
  const ranked = [...results].sort((a, b) => a.rank - b.rank);
  return (
    <HostShell>
      <div className="host-results">
        <h1>🏆 Résultats</h1>
        <div className="results-grid">
          {ranked.map((r) => (
            <div key={r.coupleId} className={`result-tile rank-${r.rank}`}>
              <div className="rt-emoji">{r.title.emoji}</div>
              <div className="rt-name">{r.name}</div>
              <div className="rt-title">{r.title.label}</div>
              <div className="rt-compat">{r.compatibility}%</div>
              {r.medal && (
                <div className="rt-medal">
                  {r.medal.emoji} {r.medal.label}
                </div>
              )}
              <div className="rt-score">{r.totalScore.toLocaleString("fr-FR")} pts</div>
            </div>
          ))}
        </div>
      </div>
    </HostShell>
  );
}

function modeTitle(mode: string): string {
  if (mode === "sync") return "⚡ SYNC";
  if (mode === "auction") return "💰 AUX ENCHÈRES DE L'AUTRE";
  if (mode === "wavelength") return "🎯 WAVELENGTH";
  return mode.toUpperCase();
}
