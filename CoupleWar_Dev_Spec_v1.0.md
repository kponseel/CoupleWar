# CoupleWar — Spécifications de jeu & règles d'implémentation

**Version :** 1.0 — Spec de référence pour l'équipe de développement
**Type de produit :** PWA multi-écrans (host + joueurs), couple vs couple
**Cible :** 2 à 6 couples (4 à 12 joueurs), adultes 25-50 ans, soirée apéro
**Durée d'une partie :** 25-30 min

> Ce document est la **source de vérité** pour les règles, le scoring, les états réseau et les contraintes techniques. Toute valeur chiffrée (timers, points, multiplicateurs) est centralisée dans la section 11 « Config » pour être ajustable sans toucher au code métier.

---

## 1. Architecture générale & rôles

### 1.1 Topologie

Architecture **host-authoritative** (le serveur est l'arbitre, jamais le client).

```
                  ┌─────────────────────┐
                  │   SERVEUR (Node)    │  ← autorité : scoring, timers,
                  │   WebSocket + état  │     validation, horloge maître
                  └──────────┬──────────┘
                             │ WSS
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐         ┌─────▼─────┐        ┌─────▼─────┐
   │  ÉCRAN  │         │ TÉLÉPHONE │        │ TÉLÉPHONE │   ...×12
   │   TV    │         │  Joueur 1 │        │  Joueur 2 │
   │ (host)  │         │ (couple A)│        │ (couple A)│
   └─────────┘         └───────────┘        └───────────┘
```

### 1.2 Les trois clients

| Client | Rôle | Device typique |
|---|---|---|
| **Host / TV** | Affiche l'état public : question en cours, leaderboard, révélations, animations collectives, son. Ne joue pas. Optionnel (voir mode hostless §1.4). | Laptop, TV via navigateur, ou un téléphone posé sur la table |
| **Player** | Interface de jeu individuelle. Chaque joueur a la sienne. C'est là que se passent les réponses secrètes. | Smartphone perso |
| **Server** | Autorité absolue. Voir §1.3. | Node.js + WebSocket |

### 1.3 Principe d'autorité serveur (non négociable)

- **Tous les timers tournent côté serveur.** Le client affiche un compte à rebours visuel, mais c'est le timestamp serveur qui fait foi pour le scoring.
- **Toutes les réponses sont validées serveur.** Le client envoie `{questionId, answer, clientTimestamp}` ; le serveur calcule le score à partir de **son** horloge et de l'offset calibré (§3.2).
- **Le client ne calcule jamais de score.** Il reçoit des `score_update` du serveur et les affiche.
- **Anti-triche minimal mais réel :** un client ne peut pas soumettre deux fois la même question, ni soumettre après la deadline serveur (réponse rejetée avec `too_late`).

### 1.4 Mode hostless (sans écran TV)

Si aucun écran TV n'est connecté, **le téléphone de l'hôte (créateur de room) devient l'écran public** par roulement : les révélations et le leaderboard s'affichent sur tous les téléphones simultanément entre les rounds, puis chacun revient à son interface de réponse. À implémenter en v1.1 si le temps manque — **v1.0 peut exiger un écran TV.**

---

## 2. Cycle de vie d'une partie (game state machine)

États globaux de la room, gérés par le serveur :

```
LOBBY → PAIRING → ROUND_INTRO → ROUND_PLAY → ROUND_REVEAL → INTERLUDE
                      ↑                                          │
                      └──────────────(rounds restants)──────────┘
                                                                 │
                                              (dernier round) → FINALE → RESULTS → END
```

| État | Description | Transition |
|---|---|---|
| `LOBBY` | Les joueurs rejoignent via code à 4 lettres. | Host lance → `PAIRING` |
| `PAIRING` | Les joueurs s'apparient en couples + choisissent leur nom (§4). | Tous appariés → `ROUND_INTRO` |
| `ROUND_INTRO` | Annonce du mode + règle (3 s). | Auto → `ROUND_PLAY` |
| `ROUND_PLAY` | Phase active (réponses). | Timer ou tous répondu → `ROUND_REVEAL` |
| `ROUND_REVEAL` | Révélation + scoring animé. | Auto → `INTERLUDE` |
| `INTERLUDE` | Leaderboard + handicaps/bonus + transition. | Auto → round suivant ou `FINALE` |
| `FINALE` | Dernier round (scoring ×2.5). | → `RESULTS` |
| `RESULTS` | Titres, médailles, % compatibilité, export. | → `END` |

**Structure d'une partie standard (8 rounds + finale) :**

```
R1: Sync          (échauffement, questions légères)
R2: Enchères      (introduit le pari inter-couples)
R3: Wavelength    (change le rythme)
R4: Sync          (streak possible)
R5: Mime numérique D2 (téléphone-front, gros moment social)
R6: Enchères      (questions plus piquantes)
R7: Wavelength    (1 question registre Perel/Aron ici)
R8: Mime numérique D1 ou D3 (doodle ou emoji)
FINALE: Sync rapid-fire ×2.5
```

> **Règle 5:1 (tonalité).** Sur l'ensemble d'une partie, max 1-2 questions « vulnérables » (intimité, futur, désir). Le reste est fun/trivial. Le content team tagge chaque question `intensity: light | medium | deep` et le moteur enforce un quota `deep ≤ 2` par partie.

---

## 3. Synchronisation temporelle (le cœur technique)

### 3.1 Pourquoi c'est critique

Le mode Sync (§5) et le bonus « Cœur Battant » reposent sur la mesure de l'**écart entre les temps de réponse des deux partenaires**, à la centaine de millisecondes près. Sans horloge synchronisée, c'est impossible.

### 3.2 Calibration de l'offset (au LOBBY, une fois par client)

Chaque client estime son décalage avec l'horloge serveur via un mini-NTP :

```
1. Client note T0 = performance.now()
2. Client envoie {ping} au serveur
3. Serveur répond {serverTime}
4. Client note T1 = performance.now()
5. RTT = T1 - T0 ; latence estimée = RTT/2
6. offset = serverTime - (T0 + RTT/2)
7. Répéter 5 fois, garder la médiane des offsets (rejette les outliers réseau)
```

Ensuite, pour dater un événement local : `serverTimeEstimé = performance.now() + offset`.

### 3.3 Mesure d'une réponse

```
À l'affichage de la question :
  serveur broadcast { questionId, serverStartTime, deadline }

À la réponse du joueur :
  client envoie { questionId, answer, clientSubmitTime: performance.now() + offset }

Serveur :
  responseTime = clientSubmitTime - serverStartTime   // ms écoulées
  rejette si clientSubmitTime > deadline (+ tolérance 200ms)
  stocke responseTime pour scoring
```

### 3.4 LatencyGap (écart de synchro d'un couple)

Pour une question donnée, après réception des deux partenaires :
`latencyGap = abs(responseTime_partnerA - responseTime_partnerB)`

Utilisé pour le bonus Cœur Battant (§5.3) et la stat de fin de partie (§9).

---

## 4. Lobby & Pairing

### 4.1 Rejoindre une room

- Host crée une room → serveur génère un **code à 4 lettres** (alphabet sans voyelles pour éviter les mots, ex: `BKZF`).
- Joueurs ouvrent la PWA, entrent le code → état `LOBBY`.
- Affichage : liste des joueurs connectés en temps réel sur la TV et les téléphones.

### 4.2 Appariement en couples

Deux méthodes (proposer les deux) :

1. **Code de couple :** le premier partenaire crée un couple → reçoit un mini-code à 2 chiffres → le second le saisit pour rejoindre.
2. **Tap-to-pair :** les deux téléphones affichent la liste des joueurs non-appariés ; chacun tape le nom de l'autre ; double-confirmation = couple formé.

### 4.3 Nom de couple auto-généré

Après appariement, le serveur propose **3 noms** tirés d'un combinatoire `[Article] + [Nom pluriel] + [Adjectif]` :
- Pools : ~40 noms (`Pizzas`, `Boomers`, `Catastrophes`, `Télépathes`, `Raclettes`…) × ~40 adjectifs (`Fusionnels`, `Caféinés`, `Premium`, `Magnétiques`…).
- Les joueurs peuvent **réroller** (nouveau tirage) ou **éditer librement** (filtre anti-insultes basique).
- Exemple : « Les Raclettes Magnétiques ».

### 4.4 Permissions à demander au lobby (gesture-gated)

Au moment où l'hôte lance la partie (ce qui constitue un user gesture), demander en une fois :
- **DeviceMotion** (iOS exige `DeviceMotionEvent.requestPermission()` dans un gesture) — déguisé en « Secoue ton téléphone pour confirmer que tu es prêt ! ».
- **Caméra** (pour les selfie-réactions §8) — avec **consentement explicite et clair**, opt-out possible par joueur. Si refusé, le joueur joue normalement, juste sans capture photo.
- **Audio** : déverrouiller le Web Audio API au premier tap (créer/reprendre l'`AudioContext`).
- **Wake Lock** : acquérir `navigator.wakeLock.request('screen')` dès l'entrée en jeu, ré-acquérir sur `visibilitychange`.

---

## 5. MODE A — « Sync » (synchronisation temporelle)

### 5.1 Règle joueur

> Toi et ton/ta partenaire recevez **la même question** en même temps, sans vous voir. Répondez **vite** et **pareil**. Plus vous êtes rapides ET synchrones, plus vous marquez.

### 5.2 Déroulé

```
1. ROUND_INTRO : annonce « SYNC ! » (3s)
2. Serveur broadcast la question QCM (4 options) + serverStartTime + deadline (15s)
3. Chaque partenaire répond sur son écran (réponse cachée des deux)
4. Dès que les 2 partenaires d'un couple ont répondu → feedback privé « réponse enregistrée »
   (ne PAS révéler le match avant la révélation publique)
5. Deadline atteinte OU tous répondu → ROUND_REVEAL
6. Révélation couple par couple : match ? vitesse ? bonus ?
```

### 5.3 Scoring Sync (par couple, par question)

```
Étape 1 — points de base (par joueur, style Kahoot) :
  base = round( (1 - (responseTime / deadline) / 2) * 1000 )
  → borné [500, 1000] si réponse dans les temps, 0 sinon

Étape 2 — points couple :
  coupleBase = base_partnerA + base_partnerB

  SI réponses identiques (match) :
      coupleScore = coupleBase * 2.5
  SINON :
      coupleScore = coupleBase * 1.0   (pas de pénalité, juste pas de bonus)

Étape 3 — bonus "Cœur Battant" :
  SI match ET latencyGap < 500ms :
      coupleScore += 500
      → déclenche animation cœur synchronisé (§8) + TTS "Aligned!"

Étape 4 — streak :
  SI 3 matchs Sync consécutifs (sur les rounds Sync) :
      badge "En Symbiose" + multiplicateur x1.5 sur le PROCHAIN round Sync
  Une réponse divergente reset la streak (animation drain + SFX "aww")
```

### 5.4 Stats trackées

- `syncMatch` (bool) → alimente **SyncRate**
- `latencyGap` (ms) → alimente la stat LatencyGap médiane
- streak courante

---

## 6. MODE B — « Wavelength des couples » (transmission asymétrique)

### 6.1 Règle joueur

> Un de vous deux (**l'Émetteur**) voit une cible cachée sur un curseur. Il a **un seul mot** (ou un emoji) pour guider l'autre (**le Récepteur**) jusqu'à la cible. Pendant ce temps, **les autres couples parient** sur le résultat.

### 6.2 Le spectre

- Un axe horizontal continu (valeur 0-100) avec deux pôles étiquetés (ex: `🥗 healthy obsession` ↔ `🍔 raclette quotidienne`).
- Une **zone bullseye** placée aléatoirement, de largeur paramétrable (§11). 3 anneaux concentriques : centre (4 pts), moyen (3 pts), large (2 pts).
- Seul l'Émetteur voit la cible. Le Récepteur voit un curseur vide.

### 6.3 Déroulé

```
1. Désigner l'Émetteur du couple (alterner à chaque round Wavelength)
2. Émetteur voit le spectre + cible. A 5s pour taper UN mot (max 20 char) OU choisir 1 emoji (grille de 60)
3. L'indice s'affiche en grand sur la TV (PAS la cible)
4. PHASE RÉCEPTION (10s) :
   - le Récepteur déplace son curseur et valide
   - SIMULTANÉMENT, tous les AUTRES couples parient : "← plus à gauche" / "🎯 dans le mille" / "plus à droite →"
5. ROUND_REVEAL : on dévoile la cible, la position du Récepteur, et on résout les paris
```

### 6.4 Scoring Wavelength

```
Couple émetteur :
  selon l'anneau touché par le curseur du Récepteur → 4 / 3 / 2 / 0 pts

Couples parieurs (chacun) :
  - a parié la bonne direction de l'erreur → +1 pt
  - le Récepteur a tapé le centre (bullseye) ET le parieur avait parié "dans le mille" → +2 pts
  - sinon → 0

Catch-up (anti-décrochage) :
  SI un couple en dernière place marque 4 pts → tour bonus immédiat pour lui
```

### 6.5 Stats trackées

- `wavelengthDistance` (distance du curseur au centre, 0-100) → alimente **WavelengthAccuracy** (moyenne, plus c'est bas mieux c'est)

---

## 7. MODE C — « Aux enchères de l'autre » (pari / prédiction)

### 7.1 Règle joueur

> Un de vous (**le Cible**) répond secrètement à une question parmi 5 options. Ensuite, son/sa partenaire (**le Devineur**) ET tous les autres couples **misent des jetons** sur la vraie réponse. Bien parier = gros points. Tout miser sur le bon choix = jackpot.

### 7.2 Déroulé

```
PHASE 1 — Réponse cachée (20s) :
  - Le Cible reçoit la question + 4 options pré-générées + 1 option "autre, je tape" (texte ≤25 char)
  - Réponse validée serveur, NON affichée publiquement

PHASE 2 — Enchère (15s) :
  - Les 5 options sont révélées à tous SAUF la réponse du Cible
  - Chaque couple (sauf le Cible) reçoit 10 "jetons d'amour"
  - Mise : sur UNE option, min 1 / max 5 jetons
  - Le Devineur (partenaire du Cible) mise aussi, séparément

PHASE 3 — Révélation théâtrale :
  - Drumroll WebAudio 2s + flash blanc
  - Reveal de la vraie réponse sur la TV
  - Résolution des mises
```

### 7.3 Scoring Enchères

```
Jetons misés sur la BONNE option → rapportent x3 (convertis en points : 1 jeton = 100 pts de base)
Jetons misés sur une MAUVAISE option → perdus

Bonus "Tu me connais par cœur" (Devineur uniquement) :
  SI le Devineur a misé 5 jetons (max) sur la bonne option :
      +1000 pts bonus + animation cœur géant sur son écran

Le couple Cible ne mise pas ce round (il "subit" la révélation).
Alterner le rôle Cible à chaque round Enchères.
```

### 7.4 Stats trackées

- `predictionCorrect` (bool, pour le Devineur partenaire) → alimente **PredictionRate**
- distinguer les questions `daily` (quotidien) des questions `future/desire` pour le profil « Couple-Coloc » (§9)

---

## 8. MODE D — « Mime numérique » (asymétrique, faire deviner via l'app)

Trois sous-modes. Le moteur en choisit un selon le tag de la question. **Communication non-verbale imposée techniquement** : le Donneur ne peut transmettre que via le canal autorisé.

### 8.1 D1 — Doodle de couple

```
- Le Donneur reçoit un sujet caché (ex: "notre dispute la plus stupide")
- 30s pour dessiner au doigt (canvas tactile) ; le trait s'affiche en live sur la TV
- Le Récepteur NE voit PAS dessiner ; il tape sa réponse libre sur son écran
- Scoring : match exact/proche (fuzzy match + validation host optionnelle) → +1500 pts
- Bonus fun INDÉPENDANT : les autres couples votent le dessin le plus drôle → +500 pts au gagnant du vote
```

### 8.2 D2 — Téléphone-front (style Heads Up!)

```
- Le Récepteur tient son téléphone sur le front (écran face aux autres)
- Le mot à deviner s'affiche EN GRAND sur l'écran du Donneur (pas sur celui du Récepteur)
- Le Donneur a 30s et 5 indices texte (tapés sur SON tel) qui apparaissent un par un sur la TV
- AUCUNE parole (le canal est l'app)
- DeviceMotion sur le tel du Récepteur :
    tilt vers le BAS = "passer" (skip)
    tilt vers le HAUT = "j'ai trouvé, mot suivant"
- Caméra frontale du Récepteur : capture 5s de vidéo (ou burst photo) → rejouée au REVEAL pour le rire
- Scoring : +300 pts par mot deviné dans le temps imparti (enchaîne plusieurs mots)
```

> ⚠️ **Contrainte iOS :** DeviceMotion nécessite permission gesture-gated (déjà demandée au lobby §4.4). Si refusée → fallback boutons tactiles "passer"/"trouvé" à l'écran. **DeviceMotion ne doit JAMAIS être l'unique moyen d'interagir.**

### 8.3 D3 — Canal d'emojis

```
- Le Donneur voit un concept à transmettre (ex: "notre dimanche idéal")
- Il dispose de 6 emojis tirés au hasard parmi ~120
- Il les envoie un par un, espacés de 4s (cooldown serveur)
- Le Récepteur voit les emojis apparaître et tape sa réponse libre
- Scoring : bonne idée transmise → +1500 pts
- Chaos bonus : les autres couples peuvent aussi deviner (mode parieur) → +300 pts s'ils trouvent avant le partenaire
```

### 8.4 Stats trackées

- `emojiHit` (bool) → alimente **EmojiHits**
- `socialVote` reçus (D1) → alimente **SocialVotes**

---

## 9. Système de fin de partie : stats, titres, médailles, %

### 9.1 Les 8 stats trackées par couple (toute la partie)

| # | Stat | Calcul | Sens |
|---|---|---|---|
| 1 | `totalScore` | Somme des points | Performance brute |
| 2 | `syncRate` | % réponses identiques (mode A) | Pensée commune |
| 3 | `predictionRate` | % bons paris du Devineur (mode C) | Connaissance de l'autre |
| 4 | `latencyGap` | Écart médian des temps de réponse (mode A) | Synchro temporelle |
| 5 | `wavelengthAccuracy` | Distance moyenne au centre (mode B) | Transmission de concept |
| 6 | `emojiHits` | % succès mode D3 | Télépathie symbolique |
| 7 | `divergenceScore` | % réponses opposées | Désaccord |
| 8 | `socialVotes` | Votes reçus des autres couples | Charisme de groupe |

### 9.2 Algorithme d'attribution du titre principal

Évaluer dans cet **ordre de priorité** (le premier match gagne), pour éviter les conflits :

```
1. 🪞 Jumeaux Cosmiques     : syncRate > 75% ET latencyGap < 800ms
2. 📡 Télépathes Quotidien  : wavelengthAccuracy top 20% ET emojiHits > 60%
3. 🧠 Profileur en Chef     : predictionRate > 70% ET syncRate < 40%
4. 🌶️ Piquants du Salon     : meilleur score sur questions taggées "spicy" (si mode pimenté actif)
5. 🌪️ Opposés Magnétiques   : divergenceScore > 50% ET totalScore top 4
6. 🎯 Cœurs Synchros        : syncRate > 60% ET latencyGap > 1500ms
7. 🎭 Co-Stars Confiants    : totalScore top 3 ET predictionRate haut ET syncRate moyen
8. 🥖 Couple-Coloc          : predictionRate haut sur "daily" MAIS bas sur "future/desire"
9. 🛋️ Coloc' du Pacifique   : latencyGap > 4000ms ET syncRate bas ET divergenceScore bas
10. 🍷 Vétérans de l'Apéro  : socialVotes haut ET score/divergence moyens
11. 🚧 Travaux en Cours      : syncRate < 30% ET predictionRate < 40%
12. ☄️ Couple Schrödinger    : fallback (stats chaotiques / aucun match ci-dessus)
```

> Chaque titre a un **libellé humoristique** (textes fournis par le content team). **Garantir qu'aucun titre n'est blessant** : « Travaux en Cours » est le plus dur et reste bienveillant + glissé dans l'humour.

### 9.3 Médaille secondaire (garantir 1 victoire par couple)

Indépendamment du titre, attribuer une médaille sur la **meilleure stat single** du couple :
- 🏆 Champions du Wavelength (meilleur `wavelengthAccuracy`)
- ⚡ Sprinters du Sync (meilleur `latencyGap`)
- 🃏 Bluffeurs de l'Année (meilleur `predictionRate`)
- 🎨 Doodlers Romantiques (plus de `socialVotes`)
- 💗 Cœurs Synchrones (meilleur `syncRate`)

Algorithme : assigner chaque médaille au couple qui excelle le plus dans cette dimension, en s'assurant qu'un max de couples en reçoivent une (assignment glouton sur les meilleures stats relatives).

### 9.4 % de compatibilité final

```
raw = (syncRate * 0.35)
    + (predictionRate * 0.25)
    + (normalize(wavelengthAccuracy) * 0.20)   // inversé : proche du centre = haut
    + ((1 - divergenceScore) * 0.20)

// Rescaling NON-LINÉAIRE : plancher à 67% (jamais de score humiliant, façon Buzzfeed)
final = 67 + raw * 33    // mappe [0,1] → [67,100]
```

Accompagné d'une **métaphore absurde** tirée d'un pool de ~60 (4 paliers de score). Ex à 89% : « Votre couple est un soufflé au fromage : techniquement risqué, mais quand ça monte, c'est sublime. »

### 9.5 Écran RESULTS & export

- Chaque téléphone affiche : titre + médaille + % + métaphore, avec sting de révélation.
- **Carte partageable** générée (canvas → image) exportée via **Web Share API** (`navigator.share`) : nom du couple, titre, %, médaille, branding.
- **Album souvenir de session** : compilation des dessins, citations, selfies-réactions capturés (§8) → exportable.

---

## 10. UX, feedback & contraintes techniques par plateforme

### 10.1 Matrice de support (mai 2026)

| Feature | Android (Chrome) | iOS (Safari/PWA) | Usage | Fallback iOS |
|---|---|---|---|---|
| WebSocket | ✅ | ✅ | Cœur réseau | — |
| Web Audio API | ✅ | ✅ (unlock au 1er tap) | SFX, drumroll, TTS | — |
| Wake Lock | ✅ | ✅ (iOS 16.4+) | Écran allumé | — (acquérir + ré-acquérir sur visibilitychange) |
| Vibration API | ✅ | ❌ **jamais** | Feedback haptique | **screen-pulse + audio click** |
| DeviceMotion | ✅ | ✅ (permission gesture) | Shake, tilt mode D2 | boutons tactiles |
| Fullscreen API (div) | ✅ | ❌ | Immersion | `display: standalone` (manifest PWA) |
| Web Share API | ✅ | ✅ | Export carte | — |
| Caméra (getUserMedia) | ✅ | ✅ (consentement) | Selfie-réaction | jeu sans capture |
| Web Speech (TTS) | ✅ | ✅ (souvent muet en silent mode) | Narrateur ironique | texte animé à l'écran |

> **Règle d'or :** aucune mécanique de scoring ne dépend d'une feature non supportée par iOS. Vibration, fullscreen et DeviceMotion sont **toujours du bonus**, jamais critiques.

### 10.2 Moments « wow » synchronisés (pattern serveur)

Pattern général : le serveur envoie `{ event: "REVEAL", executeAt: serverTime + 1500 }` à tous les clients. Chaque client convertit `executeAt` en temps local (via offset §3.2) et déclenche l'animation **au même instant** → effet de synchro multi-écrans.

Implémenter au minimum :
- **Flash collectif** : tous les écrans → couleur pleine 200ms (vert/rouge) + sting audio.
- **Drumroll → flash blanc → reveal** : durée exacte 1500ms, freeze 100ms avant l'affichage.
- **Pluie de cœurs** (canvas-confetti) sur le couple gagnant d'un Sync parfait.
- **Cœur Battant** : screen-pulse cardiaque 60-90 bpm (CSS keyframes) + audio + (Android) vibration.
- **Selfie-réaction** : burst caméra frontale 1s au reveal d'un match/mismatch notable → grille sur la TV.
- **TTS narrateur** : annonce les positions du leaderboard, les titres.

### 10.3 Leaderboard dynamique (INTERLUDE)

- **Reveal bottom-up** : animer les positions de la dernière à la première, pause 500ms par ligne. Top 3 réservé à la FINALE.
- **Double échelle** : afficher `totalScore` ET `SyncMètre` (= syncRate live) en parallèle.
- **Auras visuelles** : dernier = aura glacée bleue, premier = aura flammes rouge.
- **Mécanique anti-décrochage (Mario Kart)** :
  - leader du round → handicap secret au round suivant (ex: « répondez les yeux fermés », deadline /2)
  - dernier → bonus secret (ex: « prochain Sync ×2 »)
- **Inflation finale** : FINALE ×2.5 → tout couple à ≥75% du leader peut encore gagner.
- **Scrapbook** : capturer à chaque round une « citation marquante » (pire mensonge, dessin raté) → consultable + exportée.

---

## 11. Config centralisée (à exposer en variables, pas en dur)

```json
{
  "room":            { "minCouples": 2, "maxCouples": 6, "codeLength": 4 },
  "sync": {
    "deadlineMs": 15000, "baseMin": 500, "baseMax": 1000,
    "matchMultiplier": 2.5, "heartbeatGapMs": 500, "heartbeatBonus": 500,
    "streakThreshold": 3, "streakMultiplier": 1.5, "lateToleranceMs": 200
  },
  "wavelength": {
    "clueTimeMs": 5000, "receiveTimeMs": 10000,
    "bullseyePts": 4, "midPts": 3, "outerPts": 2,
    "betCorrectPts": 1, "betBullseyePts": 2, "emojiGridSize": 60
  },
  "auction": {
    "answerTimeMs": 20000, "betTimeMs": 15000,
    "tokensPerRound": 10, "minBet": 1, "maxBet": 5,
    "winMultiplier": 3, "tokenToPoints": 100, "perfectGuessBonus": 1000,
    "freeTextMaxChars": 25
  },
  "mime": {
    "doodleTimeMs": 30000, "headsupTimeMs": 30000, "headsupCluesMax": 5,
    "emojiCooldownMs": 4000, "emojiPoolSize": 120, "emojiHandSize": 6,
    "matchPts": 1500, "socialVoteBonus": 500, "headsupPerWordPts": 300,
    "otherCoupleGuessPts": 300, "cameraClipSec": 5
  },
  "results": {
    "compatFloor": 67,
    "weights": { "sync": 0.35, "prediction": 0.25, "wavelength": 0.20, "divergence": 0.20 }
  },
  "tone": { "maxDeepQuestionsPerGame": 2, "funToVulnerableRatio": "5:1" },
  "reveal": { "drumrollMs": 1500, "freezeMs": 100, "flashMs": 200 }
}
```

---

## 12. Modèle de données (contrat content team ↔ moteur)

### 12.1 Question (schéma générique)

```json
{
  "id": "q_sync_0042",
  "mode": "sync | wavelength | auction | mime_d1 | mime_d2 | mime_d3",
  "intensity": "light | medium | deep",
  "category": "open_tabs | mode_panique | mythologie | curseur_desir | avatar_couple",
  "spicy": false,
  "tags": ["daily"],
  "text": "Quel onglet est ouvert en permanence sur le téléphone de ton/ta partenaire ?",
  "options": ["LinkedIn", "Vinted", "WhatsApp (sa mère)", "tracker de colis"],
  "wavelength": { "poleLeft": "🥗 healthy obsession", "poleRight": "🍔 raclette quotidienne" },
  "mime": { "secret": "notre dispute la plus stupide" }
}
```

- `options` requis pour `sync` et `auction` (auction ajoute toujours une 5e option « autre »).
- `wavelength` requis pour le mode B.
- `mime.secret` requis pour les sous-modes D.
- `tags` utilisé pour le profil « Couple-Coloc » (distinguer `daily` vs `future`/`desire`).

### 12.2 État de partie (côté serveur, simplifié)

```json
{
  "roomCode": "BKZF",
  "state": "ROUND_PLAY",
  "currentRound": 4,
  "currentMode": "sync",
  "couples": [
    {
      "id": "c1", "name": "Les Raclettes Magnétiques",
      "players": ["p1", "p2"],
      "totalScore": 8400,
      "stats": {
        "syncMatches": 3, "syncTotal": 4, "latencyGaps": [320, 880, 410],
        "predictionCorrect": 2, "predictionTotal": 3,
        "wavelengthDistances": [12, 30], "emojiHits": 1, "emojiTotal": 1,
        "divergences": 1, "socialVotes": 4
      },
      "streak": 2, "handicap": null
    }
  ]
}
```

---

## 13. Priorisation pour le MVP (v1.0)

**MVP minimal jouable (à livrer en premier) :**
1. Lobby + pairing + noms de couples (§4)
2. Synchro d'horloge (§3) — **indispensable, ne pas zapper**
3. Mode Sync complet avec scoring + Cœur Battant (§5)
4. Mode Enchères (§7) — le plus rejouable, fort sur le multi-couple
5. Leaderboard bottom-up + INTERLUDE (§10.3)
6. Écran RESULTS avec titres + % + Web Share (§9)
7. Wake Lock + Web Audio + flash collectif (§10)

**v1.1 (après validation) :**
- Mode Wavelength (§6)
- Mode Mime D3 (emojis) — le plus simple des D
- Selfie-réactions + scrapbook
- Mécaniques anti-décrochage (handicaps)

**v1.2 :**
- Mime D1 (doodle) et D2 (téléphone-front + DeviceMotion + caméra)
- Mode hostless
- Mode « Pimenté »

> **Conseil d'archi :** construire le **moteur de round générique** (intro → play → reveal → score → interlude) d'abord, puis brancher chaque mode comme un plugin qui implémente `{ startPlay(), collectAnswers(), computeScore(), buildReveal() }`. Ça permet d'ajouter Wavelength/Mime sans toucher au cœur.

---

## 14. Checklist de tests critiques

- [ ] Offset d'horloge : tester avec 8 téléphones sur réseau 4G dégradé (latence 200ms+)
- [ ] LatencyGap fiable à ±100ms entre 2 téléphones différents (iOS + Android mélangés)
- [ ] Reconnexion : un joueur qui perd le réseau 10s revient sans casser la room
- [ ] Wake Lock survit à un lock/unlock manuel de l'écran (visibilitychange)
- [ ] Audio se déverrouille bien au 1er tap iOS, drumroll audible
- [ ] DeviceMotion refusé → fallback boutons fonctionne (mode D2)
- [ ] Caméra refusée → jeu continue sans capture
- [ ] Aucune option de scoring ne plante si un partenaire ne répond pas (timeout propre)
- [ ] Quota `deep ≤ 2` respecté sur une partie complète
- [ ] Tous les couples reçoivent une médaille (assignment glouton sans trou)
- [ ] % compatibilité jamais < 67%
- [ ] Reveal synchronisé visuellement sur 4+ écrans (test à l'œil + log timestamps)

---

*Fin de la spec v1.0. Toute modification de règle ou de valeur chiffrée doit passer par la §11 (Config) et être versionnée.*
