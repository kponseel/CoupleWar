// Génère le guide PDF d'onboarding & d'explication des jeux de CoupleWar.
// Les valeurs chiffrées sont LUES depuis config/game.config.json (source de
// vérité §11) pour rester synchronisées avec le jeu. Régénérer après toute
// modification de règle : `npm run guide`.
import PDFDocument from "pdfkit";
import { createWriteStream, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// --- Parseur JSONC minimal (mêmes règles que packages/shared/jsonc) ---
function parseJsonc(input) {
  let out = "";
  let inString = false, q = "", line = false, block = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (line) { if (c === "\n") { line = false; out += c; } continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (inString) {
      out += c;
      if (c === "\\") { out += input[i + 1] ?? ""; i++; continue; }
      if (c === q) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; q = c; out += c; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const cfg = parseJsonc(readFileSync(resolve(root, "config", "game.config.json"), "utf8"));
const sec = (ms) => `${Math.round(ms / 1000)} s`;

// --- Palette (alignée sur le thème de l'app) ---
const C = {
  bg: "#0b0b16",
  panel: "#1c1730",
  accent: "#e0245e",
  accent2: "#ff5e8a",
  gold: "#ffd84d",
  text: "#f3f1fb",
  muted: "#a59fc4",
  green: "#1db954",
};

mkdirSync(resolve(root, "docs"), { recursive: true });
const outPath = resolve(root, "docs", "CoupleWar_Guide.pdf");
const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, bufferPages: true });
doc.pipe(createWriteStream(outPath));

const W = 595.28, H = 841.89;
const M = 54; // marge intérieure
const CW = W - M * 2; // largeur de contenu

// ----------------------------------------------------------------------------
// Helpers de mise en page
// ----------------------------------------------------------------------------
function bgPage() {
  doc.addPage();
  doc.rect(0, 0, W, H).fill(C.bg);
  doc.fillColor(C.text);
}

/** Petit cœur vectoriel. */
function heart(cx, cy, s, color) {
  doc.save().translate(cx, cy).scale(s / 32);
  doc
    .path("M0,10 C-12,-2 -28,-2 -28,-15.5 C-28,-21.3 -23.3,-26 -17.5,-26 C-13.9,-26 -10.6,-24.1 -8.8,-21.2 C-7,-24.1 -3.7,-26 -0.1,-26 C5.7,-26 10.4,-21.3 10.4,-15.5 C10.4,-2 -3.6,-2 -8.8,10 Z")
    .fill(color);
  doc.restore();
}

let y = 0;
function heading(txt, color = C.gold) {
  if (y > H - 140) bgPage(), (y = M);
  doc.fillColor(color).font("Helvetica-Bold").fontSize(17).text(txt, M, y, { width: CW });
  y = doc.y + 4;
  doc.moveTo(M, y).lineTo(M + 46, y).lineWidth(3).strokeColor(C.accent).stroke();
  y += 12;
}
function sub(txt) {
  if (y > H - 110) bgPage(), (y = M);
  doc.fillColor(C.accent2).font("Helvetica-Bold").fontSize(12.5).text(txt, M, y, { width: CW });
  y = doc.y + 3;
}
function para(txt, opts = {}) {
  const color = opts.color ?? C.text;
  const size = opts.size ?? 10.5;
  if (y > H - 80) bgPage(), (y = M);
  doc.fillColor(color).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  doc.text(txt, M + (opts.indent ?? 0), y, { width: CW - (opts.indent ?? 0), align: opts.align ?? "left", lineGap: 2 });
  y = doc.y + (opts.gap ?? 6);
}
function bullet(txt, color = C.text) {
  if (y > H - 70) bgPage(), (y = M);
  const x = M + 6;
  doc.circle(x, y + 6, 2.2).fill(C.gold);
  doc.fillColor(color).font("Helvetica").fontSize(10.5).text(txt, x + 12, y, { width: CW - 22, lineGap: 2 });
  y = doc.y + 5;
}
/** Encadré coloré (astuce / règle). */
function callout(title, txt, color = C.accent) {
  if (y > H - 130) bgPage(), (y = M);
  const padX = 14, padY = 12;
  const startY = y;
  doc.font("Helvetica").fontSize(10);
  const textH = doc.heightOfString(txt, { width: CW - padX * 2, lineGap: 2 });
  const boxH = padY * 2 + 16 + textH;
  doc.roundedRect(M, startY, CW, boxH, 10).fillAndStroke(C.panel, color);
  doc.fillColor(color).font("Helvetica-Bold").fontSize(10.5).text(title, M + padX, startY + padY, { width: CW - padX * 2 });
  doc.fillColor(C.text).font("Helvetica").fontSize(10).text(txt, M + padX, startY + padY + 16, { width: CW - padX * 2, lineGap: 2 });
  y = startY + boxH + 12;
}
/** Carte de mode de jeu avec badge numéroté et pastille de durée. */
function modeCard(badge, title, timing, lines) {
  const need = 60 + lines.length * 16;
  if (y > H - need) bgPage(), (y = M);
  const startY = y;
  doc.font("Helvetica").fontSize(10);
  let innerH = 40;
  for (const l of lines) innerH += doc.heightOfString(l, { width: CW - 60, lineGap: 1 }) + 5;
  const boxH = innerH + 18;
  doc.roundedRect(M, startY, CW, boxH, 12).fillAndStroke(C.panel, "#2c2447");
  // Badge vectoriel (cercle accent + libellé) au lieu d'un emoji (police-dépendant).
  doc.circle(M + 30, startY + 28, 15).fill(C.accent);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(13).text(badge, M + 15, startY + 21, { width: 30, align: "center" });
  doc.fillColor(C.gold).font("Helvetica-Bold").fontSize(14).text(title, M + 56, startY + 21, { width: CW - 190 });
  // pastille durée
  if (timing) {
    const tw = doc.widthOfString(timing, { fontSize: 9 }) + 18;
    doc.roundedRect(M + CW - tw - 14, startY + 14, tw, 18, 9).fill(C.accent);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9).text(timing, M + CW - tw - 14, startY + 19, { width: tw, align: "center" });
  }
  let ly = startY + 44;
  for (const l of lines) {
    doc.circle(M + 22, ly + 5, 2).fill(C.accent2);
    doc.fillColor(C.text).font("Helvetica").fontSize(10).text(l, M + 32, ly, { width: CW - 48, lineGap: 1 });
    ly = doc.y + 5;
  }
  y = startY + boxH + 14;
}

// ============================================================================
// PAGE 1 — Couverture
// ============================================================================
bgPage();
doc.rect(0, 0, W, 250).fill(C.panel);
heart(W / 2, 150, 90, C.accent);
heart(W / 2 - 4, 146, 40, C.accent2);
doc.fillColor(C.gold).font("Helvetica-Bold").fontSize(48).text("CoupleWar", 0, 280, { width: W, align: "center" });
doc.fillColor(C.muted).font("Helvetica").fontSize(14).text("Le party game qui mesure votre couple. En vrai.", 0, 338, { width: W, align: "center" });

doc.roundedRect(M + 40, 410, CW - 80, 150, 14).fillAndStroke(C.panel, C.accent);
doc.fillColor(C.text).font("Helvetica").fontSize(12);
const facts = [
  ["Joueurs", `${cfg.room.minCouples} a ${cfg.room.maxCouples} couples (${cfg.room.minCouples * 2} a ${cfg.room.maxCouples * 2} personnes)`],
  ["Duree", "environ 25-30 min"],
  ["Materiel", "1 ecran TV/host + 1 smartphone par joueur"],
  ["Ambiance", "adultes, soiree apero"],
];
let fy = 430;
for (const [k, v] of facts) {
  doc.fillColor(C.gold).font("Helvetica-Bold").fontSize(11).text(k, M + 64, fy, { width: 90 });
  doc.fillColor(C.text).font("Helvetica").fontSize(11).text(v, M + 160, fy, { width: CW - 200 });
  fy += 30;
}

doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(10).text(
  `Guide d'onboarding & regles  -  config v${cfg.configVersion}  -  genere automatiquement`,
  0, H - 70, { width: W, align: "center" },
);

// ============================================================================
// PAGE 2 — Le principe + installation
// ============================================================================
bgPage();
y = M;
heading("Le principe en 30 secondes");
para(
  "CoupleWar oppose plusieurs couples dans une serie de mini-jeux joues simultanement sur smartphone. " +
    "Chaque manche mesure une facette de votre complicite : pensez-vous pareil ? au meme rythme ? vous " +
    "connaissez-vous vraiment ? Un grand ecran (la TV) affiche les questions, les revelations spectaculaires " +
    "et le classement en direct. A la fin, chaque couple repart avec un titre, une medaille et un pourcentage " +
    "de compatibilite (jamais inferieur a " + cfg.results.compatFloor + " % : ici, personne n'est humilie).",
);
callout(
  "L'idee maitresse",
  "Ce n'est pas un jeu de connaissances : c'est un jeu de SYNCHRONISATION. On ne gagne pas en ayant " +
    "raison, on gagne en etant aligne avec son/sa partenaire. Vitesse + accord = jackpot.",
  C.accent2,
);

heading("Les trois ecrans");
sub("La TV (l'hote)");
para("Un ordinateur, une TV via navigateur, ou un telephone pose sur la table. Elle affiche tout ce qui est public : la question, le compte a rebours, les revelations, le classement. Elle ne joue pas.", { color: C.muted });
sub("Le telephone (chaque joueur)");
para("C'est la que se passe le jeu secret : vos reponses, vos mises, vos choix. Personne ne voit votre ecran.", { color: C.muted });
sub("Le serveur (l'arbitre invisible)");
para("Il garde le temps, calcule tous les scores et valide tout. Impossible de tricher sur le chrono ou les points : c'est lui qui fait foi.", { color: C.muted });

heading("Installation & lancement (3 min)");
bullet("L'hote ouvre l'app sur le grand ecran et clique sur « Lancer sur la TV ». Un code a 4 lettres apparait.");
bullet("Chaque joueur ouvre l'app sur son telephone, saisit ce code et son prenom.");
bullet("On forme les couples : l'un cree le couple (il recoit un code a 2 chiffres), l'autre saisit ce code pour le rejoindre.");
bullet("Chaque couple choisit (ou re-tire) un nom rigolo, puis appuie sur « Pret ».");
bullet("Quand tous les couples sont prets, l'hote lance la partie. C'est parti !");
callout(
  "Astuce reseau",
  "Tout le monde doit etre sur le meme acces (wifi ou data). Si un telephone perd la connexion, pas de " +
    "panique : il se reconnecte tout seul et retrouve la manche en cours.",
  C.green,
);

// ============================================================================
// PAGE 3 — Deroule d'une manche + Mode Sync
// ============================================================================
bgPage();
y = M;
heading("Comment se deroule une manche");
para("Chaque manche suit toujours le meme rythme, quel que soit le jeu :");
bullet("Intro (" + sec(cfg.introMs) + ") : la TV annonce le jeu et rappelle la regle.");
bullet("Jeu : vous repondez/jouez sur votre telephone pendant que le chrono tourne.");
bullet("Revelation : la TV devoile les reponses couple par couple, avec animations et sons.");
bullet("Classement : le tableau des scores se met a jour, de la derniere place vers la premiere.");
para("La partie enchaine plusieurs manches, puis une FINALE qui rapporte gros (score x" + cfg.finale.scoreMultiplier + "), avant l'ecran final des resultats.", { color: C.muted });

callout(
  "Ton de la soiree",
  "Le jeu reste leger et fun. Au maximum " + cfg.tone.maxDeepQuestionsPerGame + " questions « intimes » par " +
    "partie (ratio " + cfg.tone.funToVulnerableRatio + " fun/perso). On rit, on ne se met pas mal a l'aise.",
  C.gold,
);

heading("Jeu 1  -  Sync : pensez pareil, vite");
modeCard("1", "Sync", sec(cfg.sync.deadlineMs), [
  "Vous et votre partenaire recevez LA MEME question (QCM) en meme temps, sans vous voir.",
  "Repondez le plus vite possible ET la meme chose que l'autre.",
  "Plus vous etes rapides ET synchrones, plus vous marquez.",
]);
sub("Comment on marque");
bullet("Des points de base selon votre vitesse (plus c'est rapide, plus c'est haut).");
bullet("Reponses identiques (« match ») : le score du couple est multiplie par " + cfg.sync.matchMultiplier + ".");
bullet("« Coeur Battant » : si vous matchez ET repondez a moins de " + cfg.sync.heartbeatGapMs + " ms d'ecart, bonus de +" + cfg.sync.heartbeatBonus + " et animation coeur synchronise.");
bullet("Symbiose : " + cfg.sync.streakThreshold + " matchs Sync d'affilee debloquent un multiplicateur x" + cfg.sync.streakMultiplier + " sur le prochain Sync.");
callout(
  "Le secret du Sync",
  "Ne cherchez pas LA bonne reponse : cherchez la reponse que votre partenaire va donner. C'est un jeu " +
    "de complicite, pas de logique. Et repondez vite : l'hesitation coute des points.",
  C.accent2,
);

// ============================================================================
// PAGE 4 — Mode Enchères
// ============================================================================
bgPage();
y = M;
heading("Jeu 2  -  Aux encheres de l'autre : pariez juste");
modeCard("2", "Encheres", sec(cfg.auction.answerTimeMs) + " + " + sec(cfg.auction.betTimeMs), [
  "Un membre d'un couple (la CIBLE) repond en secret a une question.",
  "Ensuite, son/sa partenaire ET tous les autres couples MISENT des jetons sur la vraie reponse.",
  "Bien parier rapporte gros. Tout miser sur le bon choix : jackpot.",
]);
sub("Les deux phases");
bullet("Phase 1 (" + sec(cfg.auction.answerTimeMs) + ") : la Cible choisit une reponse (parmi 4) ou tape la sienne (max " + cfg.auction.freeTextMaxChars + " caracteres). Personne ne la voit.");
bullet("Phase 2 (" + sec(cfg.auction.betTimeMs) + ") : toutes les options sont revelees. Chaque couple mise de " + cfg.auction.minBet + " a " + cfg.auction.maxBet + " jetons (sur " + cfg.auction.tokensPerRound + " recus) sur l'option qu'il croit etre la bonne.");
sub("Comment on marque");
bullet("Jetons mises sur la BONNE option : multiplies par " + cfg.auction.winMultiplier + " (1 jeton = " + cfg.auction.tokenToPoints + " points de base).");
bullet("Jetons mises sur une mauvaise option : perdus.");
bullet("« Tu me connais par coeur » : si le/la partenaire de la Cible mise le maximum (" + cfg.auction.maxBet + " jetons) sur la bonne reponse, bonus de +" + cfg.auction.perfectGuessBonus + " et coeur geant a l'ecran.");
para("Le couple Cible ne mise pas ce tour-la (il « subit » la revelation). Le role de Cible tourne a chaque manche d'encheres.", { color: C.muted });
callout(
  "Strategie d'encheres",
  "Vous connaissez bien la Cible ? Misez gros (jusqu'au jackpot). Vous doutez ? Repartissez prudemment. " +
    "La revelation est theatrale : roulement de tambour, flash blanc, puis verdict. Frissons garantis.",
  C.gold,
);

heading("Et apres ? (a venir)");
para(
  "D'autres jeux rejoignent CoupleWar dans les prochaines versions : Wavelength (transmettre un concept avec un " +
    "seul mot), Mime numerique (dessin, telephone-front facon Heads Up!, canal d'emojis). Le moteur est deja " +
    "concu pour les accueillir.",
  { color: C.muted },
);

// ============================================================================
// PAGE 5 — Classement, fin de partie, FAQ
// ============================================================================
bgPage();
y = M;
heading("Le classement & la remontada");
bullet("Le tableau se revele de la derniere a la premiere place, avec des auras (bleu glace pour le dernier, flammes rouges pour le premier).");
bullet("Deux jauges : le score total ET le « SyncMetre » (votre taux de reponses synchrones).");
bullet("La FINALE rapporte x" + cfg.finale.scoreMultiplier + " : tant que vous etes a portee du leader, tout reste jouable jusqu'au bout.");

heading("La fin de partie : titres, medailles, %");
para("Chaque couple repart avec trois recompenses :");
sub("Un titre");
para("Attribue selon votre profil de jeu : Jumeaux Cosmiques (ultra synchrones), Profileur en Chef (vous lisez l'autre), Opposes Magnetiques (jamais d'accord mais inseparables)... Le plus dur, « Travaux en Cours », reste bienveillant.", { color: C.muted });
sub("Une medaille");
para("Pour votre meilleure stat : Sprinters du Sync, Bluffeurs de l'Annee, Coeurs Synchrones... L'attribution garantit qu'un maximum de couples en recoivent une.", { color: C.muted });
sub("Un pourcentage de compatibilite");
para("Un score final entre " + cfg.results.compatFloor + " % et 100 %, accompagne d'une metaphore absurde (« Votre couple est un souffle au fromage... »). Partageable en une image via le bouton de partage.", { color: C.muted });
callout(
  "La regle d'or des resultats",
  "Le pourcentage ne descend JAMAIS sous " + cfg.results.compatFloor + " %, et chaque couple gagne une medaille. " +
    "CoupleWar celebre les couples, il ne les juge pas.",
  C.green,
);

heading("Questions frequentes");
sub("Un joueur a perdu le reseau, on fait quoi ?");
para("Rien : il se reconnecte automatiquement et retrouve la manche en cours. Son couple continue de jouer entre-temps.", { color: C.muted });
sub("Faut-il un compte, une installation ?");
para("Non. On ouvre l'app dans le navigateur. Elle est « installable » (icone sur l'ecran d'accueil) mais ce n'est pas obligatoire.", { color: C.muted });
sub("Peut-on jouer a 2 couples seulement ?");
para("Oui, de " + cfg.room.minCouples + " a " + cfg.room.maxCouples + " couples. Plus on est de couples, plus les encheres sont folles.", { color: C.muted });
sub("C'est gênant/intime ?");
para("Non : maximum " + cfg.tone.maxDeepQuestionsPerGame + " questions un peu perso par partie, le reste est fun et trivial. Ambiance apero, pas therapie de couple.", { color: C.muted });

// ----------------------------------------------------------------------------
// Pieds de page (numerotation) sur toutes les pages
// ----------------------------------------------------------------------------
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc.fillColor(C.muted).font("Helvetica").fontSize(8);
  doc.text("CoupleWar  -  guide de jeu", M, H - 30, { width: CW, align: "left", lineBreak: false });
  doc.text(`${i + 1} / ${range.count}`, M, H - 30, { width: CW, align: "right", lineBreak: false });
}

doc.end();
console.log("Guide PDF genere : docs/CoupleWar_Guide.pdf (" + range.count + " pages, config v" + cfg.configVersion + ")");
