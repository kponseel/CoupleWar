import type { CoupleResult } from "@couplewar/shared";

/** Génère une carte partageable (canvas → image) et l'exporte via Web Share API (§9.5). */
export async function shareResultCard(r: CoupleResult): Promise<void> {
  const canvas = drawCard(r);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  const text = `${r.name} — ${r.title.emoji} ${r.title.label} · ${r.compatibility}% de compatibilité · CoupleWar`;

  if (blob) {
    const file = new File([blob], "couplewar.png", { type: "image/png" });
    const canShareFiles =
      typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
    if (canShareFiles) {
      try {
        await navigator.share({ files: [file], text, title: "CoupleWar" });
        return;
      } catch {
        /* annulé : on tente le fallback */
      }
    }
    // Fallback : téléchargement de l'image.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "couplewar.png";
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (navigator.share) {
    await navigator.share({ text, title: "CoupleWar" }).catch(() => undefined);
  }
}

function drawCard(r: CoupleResult): HTMLCanvasElement {
  const W = 1080;
  const H = 1080;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1a0b2e");
  grad.addColorStop(1, "#0b0b16");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd84d";
  ctx.font = "bold 54px system-ui, sans-serif";
  ctx.fillText("CoupleWar", W / 2, 120);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText(r.name, W / 2, 300);

  ctx.font = "120px system-ui, sans-serif";
  ctx.fillText(r.title.emoji, W / 2, 470);

  ctx.fillStyle = "#ff5e8a";
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.fillText(r.title.label, W / 2, 560);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 180px system-ui, sans-serif";
  ctx.fillText(`${r.compatibility}%`, W / 2, 760);
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillText("de compatibilité", W / 2, 810);

  if (r.medal) {
    ctx.font = "40px system-ui, sans-serif";
    ctx.fillStyle = "#ffd84d";
    ctx.fillText(`${r.medal.emoji} ${r.medal.label}`, W / 2, 900);
  }

  ctx.fillStyle = "#b8b8d0";
  ctx.font = "italic 30px system-ui, sans-serif";
  wrapText(ctx, r.metaphor, W / 2, 980, W - 160, 40);

  return c;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
