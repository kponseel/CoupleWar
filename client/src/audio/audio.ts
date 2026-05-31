/**
 * Web Audio (§4.4 / §10.1) : déverrouillé au 1er tap (iOS). Sons synthétisés
 * (pas d'assets) : sting, drumroll, "aligned". TTS via SpeechSynthesis si dispo
 * (fallback silencieux). Aucune mécanique de scoring ne dépend de l'audio.
 */
let ctx: AudioContext | null = null;
let unlocked = false;

export function unlockAudio(): void {
  if (unlocked) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    // Buffer muet pour débloquer iOS.
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    void ctx.resume();
    unlocked = true;
  } catch {
    /* audio indisponible : on continue sans son */
  }
}

function ensure(): AudioContext | null {
  if (ctx && ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType = "sine", gain = 0.15, startOffset = 0): void {
  const c = ensure();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startOffset;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.02);
}

export const sfx = {
  tap(): void {
    tone(440, 60, "triangle", 0.08);
  },
  success(): void {
    tone(660, 120, "sine", 0.18);
    tone(880, 180, "sine", 0.18, 0.1);
  },
  fail(): void {
    tone(220, 250, "sawtooth", 0.12);
    tone(180, 300, "sawtooth", 0.12, 0.08);
  },
  aligned(): void {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 160, "sine", 0.16, i * 0.09));
  },
  flash(): void {
    tone(120, 180, "square", 0.2);
  },
  /** Drumroll synthétique de durée donnée + cymbale finale. */
  drumroll(durationMs: number): void {
    const c = ensure();
    if (!c) return;
    const steps = Math.max(8, Math.floor(durationMs / 60));
    for (let i = 0; i < steps; i++) {
      tone(90 + Math.random() * 30, 50, "square", 0.05, (i * durationMs) / steps / 1000);
    }
    tone(900, 300, "triangle", 0.2, durationMs / 1000);
  },
};

/** Narrateur ironique (§10.2). Fallback : ne fait rien si TTS absent/muet. */
export function speak(text: string): void {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS indisponible */
  }
}
