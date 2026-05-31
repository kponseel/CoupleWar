import { useState } from "react";
import type { CoupleView, PlayPayload } from "@couplewar/shared";
import { useStore, selectMyCoupleId, clearSession } from "../store/store.js";
import { useWakeLock } from "../hooks/useWakeLock.js";
import { Countdown } from "../components/common.js";
import { shareResultCard } from "../lib/share.js";

export function Player() {
  const snapshot = useStore((s) => s.snapshot);
  const playInGame = useStore(
    (s) => s.snapshot?.state === "ROUND_PLAY" || s.snapshot?.state === "ROUND_REVEAL",
  );
  useWakeLock(!!playInGame);

  if (!snapshot) return <CenterMsg title="Connexion…" />;

  switch (snapshot.state) {
    case "LOBBY":
    case "PAIRING":
      return <PairingView />;
    case "ROUND_INTRO":
      return <IntroMirror />;
    case "ROUND_PLAY":
    case "FINALE":
      return <PlayView />;
    case "ROUND_REVEAL":
      return <RevealMirror />;
    case "INTERLUDE":
      return <CenterMsg title="👀 Regarde la TV" subtitle="Classement en cours…" />;
    case "RESULTS":
    case "END":
      return <ResultsView />;
    default:
      return <CenterMsg title="…" />;
  }
}

function useMyCouple(): CoupleView | null {
  const snapshot = useStore((s) => s.snapshot);
  const myCoupleId = useStore(selectMyCoupleId);
  if (!snapshot || !myCoupleId) return null;
  return snapshot.couples.find((c) => c.id === myCoupleId) ?? null;
}

function PairingView() {
  const snapshot = useStore((s) => s.snapshot);
  const playerId = useStore((s) => s.playerId);
  const createCouple = useStore((s) => s.createCouple);
  const joinCouple = useStore((s) => s.joinCouple);
  const rerollName = useStore((s) => s.rerollName);
  const setCoupleName = useStore((s) => s.setCoupleName);
  const toggleReady = useStore((s) => s.toggleReady);
  const myCouple = useMyCouple();
  const [joinCode, setJoinCode] = useState("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!snapshot) return <CenterMsg title="Connexion…" />;
  const me = snapshot.players.find((p) => p.id === playerId);

  if (!myCouple) {
    return (
      <div className="player-screen">
        <h2>Forme ton couple 💞</h2>
        <p className="hint">
          Room <b>{snapshot.roomCode}</b>
        </p>
        <div className="card stack">
          <p className="hint" style={{ marginTop: 0 }}>
            Un·e des deux crée le couple et donne le code à 2 chiffres à l'autre.
          </p>
          <button
            className="btn btn-primary btn-xl"
            onClick={async () => {
              const r = await createCouple();
              if (r) setCreatedCode(r.joinCode);
            }}
          >
            Créer notre couple
          </button>
          {createdCode && (
            <div className="couple-code">
              Donne ce code à ton/ta partenaire :
              <span className="big-code">{createdCode}</span>
            </div>
          )}
          <div className="divider">— ou —</div>
          <label className="field">
            <span>Code du couple (2 chiffres)</span>
            <input
              value={joinCode}
              inputMode="numeric"
              maxLength={2}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
              placeholder="42"
              className="code-input"
            />
          </label>
          <button
            className="btn btn-ghost btn-xl"
            disabled={joinCode.length < 2}
            onClick={() => void joinCouple(joinCode)}
          >
            Rejoindre mon/ma partenaire
          </button>
        </div>
      </div>
    );
  }

  const partnerCount = myCouple.players.length;
  return (
    <div className="player-screen">
      <h2>Votre couple</h2>
      {editing ? (
        <div className="card stack">
          <input value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} placeholder={myCouple.name} />
          <button
            className="btn btn-primary"
            onClick={() => {
              void setCoupleName(myCouple.id, draft || myCouple.name);
              setEditing(false);
            }}
          >
            Valider le nom
          </button>
          <button className="btn btn-link" onClick={() => setEditing(false)}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="card stack">
          <div className="couple-name-big">{myCouple.name}</div>
          <div className="row gap">
            <button className="btn btn-ghost" onClick={() => void rerollName(myCouple.id)}>
              🎲 Reroll
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDraft(myCouple.name);
                setEditing(true);
              }}
            >
              ✏️ Éditer
            </button>
          </div>
          {partnerCount < 2 ? (
            <p className="hint">En attente de ton/ta partenaire…</p>
          ) : (
            <button
              className={`btn btn-xl ${me?.ready ? "btn-success" : "btn-primary"}`}
              onClick={() => void toggleReady(!me?.ready)}
            >
              {me?.ready ? "✅ Prêt·e !" : "Je suis prêt·e"}
            </button>
          )}
          <p className="hint">L'hôte lance la partie depuis la TV quand tout le monde est prêt.</p>
        </div>
      )}
    </div>
  );
}

function IntroMirror() {
  const intro = useStore((s) => s.intro);
  if (!intro) return <CenterMsg title="…" />;
  return (
    <div className="player-screen center">
      <div className="intro-badge">{intro.isFinale ? "🏁 FINALE" : modeName(intro.mode)}</div>
      <p className="intro-rule">{intro.rule}</p>
    </div>
  );
}

function PlayView() {
  const play = useStore((s) => s.play);
  if (!play) return <CenterMsg title="Préparez-vous…" />;
  if (play.mode === "sync") return <SyncPlay play={play} />;
  if (play.mode === "auction" && play.phase === "answer") return <AuctionAnswer play={play} />;
  if (play.mode === "auction" && play.phase === "bet") return <AuctionBet play={play} />;
  if (play.mode === "wavelength" && play.phase === "clue") return <WavelengthClue play={play} />;
  if (play.mode === "wavelength" && play.phase === "reception") return <WavelengthReception play={play} />;
  if (play.mode === "mime_d3") return <MimeEmojiPlay play={play} />;
  return <CenterMsg title="Regarde la TV" />;
}

function SyncPlay({ play }: { play: Extract<PlayPayload, { mode: "sync" }> }) {
  const answered = useStore((s) => s.answered);
  const submitAnswer = useStore((s) => s.submitAnswer);
  return (
    <div className="player-screen">
      <Countdown start={play.serverStartTime} deadline={play.deadline} />
      <h2 className="question">{play.text}</h2>
      {answered ? (
        <div className="locked">
          🔒 Réponse enregistrée
          <br />
          <small>Surprise à la révélation…</small>
        </div>
      ) : (
        <div className="options-grid">
          {play.options.map((opt, i) => (
            <button key={i} className={`btn option opt-${i}`} onClick={() => void submitAnswer(opt)}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AuctionAnswer({ play }: { play: Extract<PlayPayload, { mode: "auction"; phase: "answer" }> }) {
  const playerId = useStore((s) => s.playerId);
  const answered = useStore((s) => s.answered);
  const submitAnswer = useStore((s) => s.submitAnswer);
  const isTarget = play.targetPlayerId === playerId;
  const [free, setFree] = useState("");

  if (!isTarget) {
    return <CenterMsg title="🤫 Réponse secrète en cours" subtitle="Quelqu'un répond… préparez vos mises !" />;
  }
  if (answered) return <CenterMsg title="🔒 Ta réponse est scellée" subtitle="Que les enchères commencent !" />;

  const otherOption = play.options[play.options.length - 1];
  return (
    <div className="player-screen">
      <Countdown start={play.serverStartTime} deadline={play.deadline} />
      <div className="badge-role">Tu es la CIBLE 🎯</div>
      <h2 className="question">{play.text}</h2>
      <div className="options-grid">
        {play.options.slice(0, -1).map((opt, i) => (
          <button key={i} className={`btn option opt-${i}`} onClick={() => void submitAnswer(opt)}>
            {opt}
          </button>
        ))}
      </div>
      <div className="free-text">
        <input
          value={free}
          maxLength={25}
          placeholder={`${otherOption} (tape ta réponse)`}
          onChange={(e) => setFree(e.target.value)}
        />
        <button className="btn btn-ghost" disabled={!free.trim()} onClick={() => void submitAnswer(free.trim())}>
          Valider
        </button>
      </div>
    </div>
  );
}

function AuctionBet({ play }: { play: Extract<PlayPayload, { mode: "auction"; phase: "bet" }> }) {
  const isTarget = useStore((s) => s.isTargetThisRound);
  const betPlaced = useStore((s) => s.betPlaced);
  const submitBet = useStore((s) => s.submitBet);
  const [option, setOption] = useState<string | null>(null);
  const [tokens, setTokens] = useState(play.minBet);

  if (isTarget) {
    return <CenterMsg title="😅 Tu subis le verdict" subtitle="On parie sur TA réponse…" />;
  }
  if (betPlaced) return <CenterMsg title="💰 Mise enregistrée" subtitle="Suspense…" />;

  return (
    <div className="player-screen">
      <Countdown start={play.serverStartTime} deadline={play.deadline} />
      <h2 className="question">{play.text}</h2>
      <p className="hint">Sur quelle réponse paries-tu ?</p>
      <div className="options-grid">
        {play.options.map((opt, i) => (
          <button
            key={i}
            className={`btn option opt-${i} ${option === opt ? "selected" : ""}`}
            onClick={() => setOption(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="token-bet">
        <div className="token-row">
          <button className="btn round" disabled={tokens <= play.minBet} onClick={() => setTokens((t) => t - 1)}>
            −
          </button>
          <span className="token-count">{tokens} 💖</span>
          <button className="btn round" disabled={tokens >= play.maxBet} onClick={() => setTokens((t) => t + 1)}>
            +
          </button>
        </div>
        <p className="hint">
          Mise {play.minBet}–{play.maxBet} jetons. Tout miser sur le bon = jackpot !
        </p>
        <button
          className="btn btn-primary btn-xl"
          disabled={!option}
          onClick={() => option && void submitBet(option, tokens)}
        >
          Parier {tokens} 💖
        </button>
      </div>
    </div>
  );
}

// --- Mime D3 : canal d'emojis (§8.3) ---

function MimeEmojiPlay({ play }: { play: Extract<PlayPayload, { mode: "mime_d3" }> }) {
  const playerId = useStore((s) => s.playerId);
  const myCoupleId = useStore(selectMyCoupleId);
  const answered = useStore((s) => s.answered);
  const mimeEmojis = useStore((s) => s.mimeEmojis);
  const sendEmoji = useStore((s) => s.sendEmoji);
  const submitAnswer = useStore((s) => s.submitAnswer);
  const [guess, setGuess] = useState("");
  const [cooldown, setCooldown] = useState(false);

  const isGiver = play.giverPlayerId === playerId;
  const isReceiver = play.receiverPlayerId === playerId;
  const isActiveCouple = myCoupleId === play.giverCoupleId;

  // Le Donneur : voit le concept + sa main d'emojis, les envoie un par un.
  if (isGiver) {
    const send = (emoji: string) => {
      if (cooldown) return;
      void sendEmoji(emoji);
      setCooldown(true);
      setTimeout(() => setCooldown(false), play.emojiCooldownMs);
    };
    return (
      <div className="player-screen">
        <Countdown start={play.serverStartTime} deadline={play.deadline} />
        <div className="badge-role">Tu es le Donneur 🤫</div>
        <p className="hint">Fais deviner, UNIQUEMENT avec des emojis :</p>
        <h2 className="question">« {play.secret} »</h2>
        <p className="hint">{cooldown ? "⏳ patiente…" : "Tape un emoji pour l'envoyer"}</p>
        <div className="emoji-hand">
          {(play.hand ?? []).map((e, i) => (
            <button key={i} className="emoji-btn" disabled={cooldown} onClick={() => send(e)} aria-label={`Envoyer ${e}`}>
              {e}
            </button>
          ))}
        </div>
        <div className="emoji-stream" aria-label="Emojis envoyés">
          {mimeEmojis.map((e, i) => (
            <span key={i}>{e}</span>
          ))}
        </div>
      </div>
    );
  }

  // Récepteur + autres couples : voient les emojis arriver, tapent leur réponse.
  if (answered) {
    return <CenterMsg title="✅ Bien deviné !" subtitle={isActiveCouple ? "Bravo à vous deux !" : "Chaos bonus en vue…"} />;
  }
  return (
    <div className="player-screen">
      <Countdown start={play.serverStartTime} deadline={play.deadline} />
      <div className="badge-role">{isReceiver ? "Tu es le Récepteur" : "Autre couple — devine aussi !"}</div>
      <p className="hint">Que veut faire deviner le Donneur ?</p>
      <div className="emoji-stream big" aria-label="Emojis reçus">
        {mimeEmojis.length === 0 ? <span className="hint">En attente d'emojis…</span> : mimeEmojis.map((e, i) => <span key={i}>{e}</span>)}
      </div>
      <div className="free-text">
        <input
          value={guess}
          maxLength={play.guessMaxChars}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="ta réponse…"
          aria-label="Réponse"
          onKeyDown={(e) => {
            if (e.key === "Enter" && guess.trim()) void submitAnswer(guess.trim());
          }}
        />
        <button className="btn btn-primary" disabled={!guess.trim()} onClick={() => void submitAnswer(guess.trim())}>
          Deviner
        </button>
      </div>
    </div>
  );
}

// --- Wavelength (§6) ---

function WavelengthClue({ play }: { play: Extract<PlayPayload, { mode: "wavelength"; phase: "clue" }> }) {
  const playerId = useStore((s) => s.playerId);
  const answered = useStore((s) => s.answered);
  const submitAnswer = useStore((s) => s.submitAnswer);
  const [clue, setClue] = useState("");
  const isEmitter = play.emitterPlayerId === playerId;

  if (!isEmitter) return <CenterMsg title="🎯 L'Émetteur cherche LE mot…" subtitle="Préparez vos paris !" />;
  if (answered) return <CenterMsg title="Indice envoyé !" subtitle="À ton/ta partenaire de viser." />;

  return (
    <div className="player-screen">
      <Countdown start={play.serverStartTime} deadline={play.deadline} />
      <div className="badge-role">Tu es l'Émetteur 🎯</div>
      <h2 className="question">Guide ton/ta partenaire vers la cible</h2>
      <Spectrum left={play.poleLeft} right={play.poleRight} target={play.target ?? null} cursor={null} />
      <p className="hint">UN seul mot (max {play.clueMaxChars} caractères).</p>
      <div className="free-text">
        <input
          value={clue}
          maxLength={play.clueMaxChars}
          onChange={(e) => setClue(e.target.value)}
          placeholder="ton indice…"
          aria-label="Indice"
        />
        <button className="btn btn-ghost" disabled={!clue.trim()} onClick={() => void submitAnswer(clue.trim())}>
          Envoyer
        </button>
      </div>
    </div>
  );
}

function WavelengthReception({ play }: { play: Extract<PlayPayload, { mode: "wavelength"; phase: "reception" }> }) {
  const playerId = useStore((s) => s.playerId);
  const myCoupleId = useStore(selectMyCoupleId);
  const answered = useStore((s) => s.answered);
  const betPlaced = useStore((s) => s.betPlaced);
  const submitAnswer = useStore((s) => s.submitAnswer);
  const submitBet = useStore((s) => s.submitBet);
  const [cursor, setCursor] = useState(50);

  const isReceiver = play.receiverPlayerId === playerId;
  const isActiveCouple = myCoupleId === play.emitterCoupleId;

  if (isReceiver) {
    if (answered) return <CenterMsg title="Position validée !" subtitle="Révélation imminente…" />;
    return (
      <div className="player-screen">
        <Countdown start={play.serverStartTime} deadline={play.deadline} />
        <div className="badge-role">Tu es le Récepteur</div>
        <h2 className="question">Indice : « {play.clue} »</h2>
        <Spectrum left={play.poleLeft} right={play.poleRight} target={null} cursor={cursor} />
        <input
          className="wave-slider"
          type="range"
          min={0}
          max={100}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          aria-label="Position du curseur"
        />
        <button className="btn btn-primary btn-xl" onClick={() => void submitAnswer(String(cursor))}>
          Valider la position
        </button>
      </div>
    );
  }

  if (isActiveCouple) return <CenterMsg title="🎯 Ton/ta partenaire place le curseur…" />;

  if (betPlaced) return <CenterMsg title="Pari enregistré !" subtitle="Suspense…" />;
  return (
    <div className="player-screen">
      <Countdown start={play.serverStartTime} deadline={play.deadline} />
      <h2 className="question">Indice : « {play.clue} »</h2>
      <p className="hint">Où est la vraie cible par rapport au curseur du Récepteur ?</p>
      <div className="bet-directions">
        <button className="btn btn-ghost btn-xl" onClick={() => void submitBet("left", 0)}>← Plus à gauche</button>
        <button className="btn btn-ghost btn-xl" onClick={() => void submitBet("bullseye", 0)}>🎯 Dans le mille</button>
        <button className="btn btn-ghost btn-xl" onClick={() => void submitBet("right", 0)}>Plus à droite →</button>
      </div>
    </div>
  );
}

/** Spectre horizontal 0..100 avec cible (émetteur) et/ou curseur (récepteur). */
function Spectrum({ left, right, target, cursor }: { left: string; right: string; target: number | null; cursor: number | null }) {
  return (
    <div className="spectrum">
      <div className="spectrum-bar">
        {target !== null && <div className="spectrum-target" style={{ left: `${target}%` }} aria-hidden />}
        {cursor !== null && <div className="spectrum-cursor" style={{ left: `${cursor}%` }} aria-hidden />}
      </div>
      <div className="spectrum-poles">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function RevealMirror() {
  const reveal = useStore((s) => s.reveal);
  const myCouple = useMyCouple();
  if (!reveal || !myCouple) return <CenterMsg title="👀 Regarde la TV" />;
  const mine = reveal.perCouple.find((p) => p.coupleId === myCouple.id);
  if (!mine) return <CenterMsg title="👀 Regarde la TV" />;
  const positive = mine.deltaScore > 0;
  return (
    <div className={`player-screen center reveal-mirror ${positive ? "good" : "meh"}`}>
      <div className="delta">
        {positive ? "+" : ""}
        {mine.deltaScore.toLocaleString("fr-FR")}
      </div>
      {mine.heartbeat && <div className="heartbeat-tag">💓 Cœur Battant !</div>}
      <p className="hint">Total : {myCouple.totalScore.toLocaleString("fr-FR")}</p>
    </div>
  );
}

function ResultsView() {
  const results = useStore((s) => s.results);
  const myCoupleId = useStore(selectMyCoupleId);
  const reset = useStore((s) => s.reset);
  if (!results) return <CenterMsg title="Calcul des résultats…" />;
  const mine = results.find((r) => r.coupleId === myCoupleId) ?? results[0];
  return (
    <div className="player-screen center results-card">
      <div className="result-title-emoji">{mine.title.emoji}</div>
      <h2>{mine.name}</h2>
      <div className="result-title">{mine.title.label}</div>
      <p className="result-blurb">{mine.title.blurb}</p>
      <div className="compat">{mine.compatibility}%</div>
      <p className="compat-label">de compatibilité</p>
      {mine.medal && (
        <div className="medal">
          {mine.medal.emoji} {mine.medal.label}
        </div>
      )}
      <p className="metaphor">« {mine.metaphor} »</p>
      <button className="btn btn-primary btn-xl" onClick={() => void shareResultCard(mine)}>
        📤 Partager notre carte
      </button>
      <button
        className="btn btn-link"
        onClick={() => {
          clearSession();
          reset();
        }}
      >
        Quitter
      </button>
    </div>
  );
}

function CenterMsg({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="player-screen center">
      <h2>{title}</h2>
      {subtitle && <p className="hint">{subtitle}</p>}
    </div>
  );
}

function modeName(mode: string): string {
  if (mode === "sync") return "SYNC !";
  if (mode === "auction") return "ENCHÈRES !";
  if (mode === "wavelength") return "WAVELENGTH !";
  if (mode === "mime_d3") return "MIME EMOJIS !";
  return mode.toUpperCase();
}
