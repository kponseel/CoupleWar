import { useState } from "react";
import { useStore } from "../store/store.js";
import { Spinner } from "../components/common.js";

export function Landing() {
  const connected = useStore((s) => s.connected);
  const clockReady = useStore((s) => s.clockReady);
  const createRoom = useStore((s) => s.createRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const [mode, setMode] = useState<"choice" | "join">("choice");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  if (!connected || !clockReady) {
    return <Spinner label={connected ? "Synchronisation de l'horloge…" : "Connexion au serveur…"} />;
  }

  return (
    <div className="landing">
      <div className="logo-big">
        <span className="logo-heart">❤️</span>
        <h1>CoupleWar</h1>
        <p className="tagline">Le party game qui mesure votre couple. En vrai.</p>
      </div>

      {mode === "choice" && (
        <div className="card stack">
          <button className="btn btn-primary btn-xl" onClick={() => void createRoom()}>
            📺 Lancer sur la TV (hôte)
          </button>
          <button className="btn btn-ghost btn-xl" onClick={() => setMode("join")}>
            📱 Rejoindre une partie
          </button>
          <p className="hint">L'hôte ouvre la partie sur un grand écran. Chaque joueur rejoint sur son téléphone.</p>
        </div>
      )}

      {mode === "join" && (
        <div className="card stack">
          <label className="field">
            <span>Ton prénom</span>
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
          </label>
          <label className="field">
            <span>Code de la partie</span>
            <input
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BKZF"
              className="code-input"
            />
          </label>
          <button
            className="btn btn-primary btn-xl"
            disabled={name.trim().length === 0 || code.trim().length < 3}
            onClick={() => void joinRoom(name.trim(), code.trim())}
          >
            Rejoindre →
          </button>
          <button className="btn btn-link" onClick={() => setMode("choice")}>
            ← Retour
          </button>
        </div>
      )}
    </div>
  );
}
