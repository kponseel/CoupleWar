# CoupleWar — Plan de finalisation (ROADMAP)

> État au commit courant. Source de vérité fonctionnelle : `CoupleWar_Dev_Spec_v1.0.md`.
> Ce document liste **tout ce qui reste à faire** pour aller du MVP actuel à un produit
> complet et déployé, organisé par jalons livrables. Chaque tâche a un critère
> d'acceptation vérifiable.

Légende : ✅ fait · 🟡 partiel · ⬜ à faire · ⏱️ estimation (j = jour-dev)

---

## 0. État actuel (rappel)

| Domaine | État |
|---|---|
| Moteur de round générique (intro→play→reveal→score→interlude) | ✅ |
| Mode Sync (scoring, Cœur Battant, streak, finale) | ✅ |
| Mode Enchères (réponse secrète, mises, jackpot) | ✅ |
| Lobby / pairing / noms auto | ✅ |
| Synchro d'horloge mini-NTP | ✅ |
| Leaderboard bottom-up + INTERLUDE | ✅ |
| RESULTS (titres, médailles, %, métaphore, Web Share) | ✅ |
| Wake Lock, Web Audio, flash collectif synchronisé | ✅ |
| Reconnexion + resync, rate-limiting, validation d'entrée | ✅ |
| PWA (manifest, service worker, offline shell) | ✅ |
| Tests (37) + e2e + CI GitHub Actions | ✅ |
| Guide PDF d'onboarding | ✅ |
| Déploiement Hostinger (Nginx/systemd/PM2 + README) | 🟡 écrit, **non validé sur VPS réel** |

---

## JALON A — Durcir & valider le MVP (avant toute nouvelle feature)

But : que la v1.0 actuelle soit **réellement jouable en soirée** et **déployée** sur
`couplewar.estim.pro`. Priorité absolue.

### A1. Validation déploiement Hostinger 🟡 (checklist prête : `docs/DEPLOY_CHECKLIST.md`) ⏱️1.5j
- [ ] Provisionner le VPS, dérouler le README pas à pas (corriger ce qui bloque)
- [ ] HTTPS + `wss://` fonctionnels sur le domaine (Certbot)
- [ ] Test de charge léger : 8–12 clients réels (mix iOS/Android) sur 4G
- **Acceptation** : une partie complète jouée de bout en bout depuis des téléphones réels via `https://couplewar.estim.pro`.

### A2. Tests sur appareils réels (§14 checklist) 🟡 (checklist prête : `docs/DEVICE_TEST_CHECKLIST.md`) ⏱️1j
- [ ] Offset d'horloge fiable à ±100 ms (iOS + Android mélangés, 4G dégradée)
- [ ] Wake Lock survit à lock/unlock manuel (`visibilitychange`)
- [ ] Audio se déverrouille au 1er tap iOS, drumroll audible
- [ ] Reconnexion réseau 10 s sans casser la room (déjà testé en e2e, à confirmer terrain)
- **Acceptation** : checklist §14 cochée sur au moins 1 iPhone + 1 Android.

### A3. Robustesse de partie ✅ ⏱️1j
- [x] Bouton hôte « ⏭️ Révéler maintenant » (force la fin de phase, anti-blocage)
- [x] Écran/message clair si la room expire pendant qu'on joue (`room_expired`)
- [x] Filets de sécurité existants confirmés (timeouts de round, partenaire absent géré)
- **Acceptation** : ✅ contrôle hôte + 2 tests d'intégration `forceReveal` (autorisation + hors-phase).

### A4. Accessibilité & UX mobile ✅ (à confirmer Lighthouse sur device, cf A2) ⏱️1j
- [x] Cibles tactiles ≥ 48px, focus clavier visible (`:focus-visible`)
- [x] `prefers-reduced-motion` : animations coupées proprement
- [x] Safe-area iOS (encoche/barre home) ; défilement sur petit écran (clavier)
- [x] ARIA sur le compte à rebours (`role="timer"`)
- **Acceptation** : ✅ côté code ; score Lighthouse à vérifier sur appareil réel (A2).

---

## JALON B — v1.1 : enrichir le jeu (après feu vert)

### B0. Mode solo (1 couple + TV) ✅ — ajout dev/test
- [x] `canStart(solo)` / `startGame(solo)` : 1 couple complet suffit
- [x] Bouton lobby « 🧪 Lancer en solo » ; modes inter-couples dégradent proprement
- **Acceptation** : ✅ e2e solo (sync→auction→wavelength→finale→résultats) + test d'intégration.

### B1. Mode Wavelength (§6) ✅ ⏱️2.5j
Le plus simple à brancher sur le moteur générique (plugin asymétrique).
- [x] Plugin `wavelengthMode` : Émetteur voit la cible, donne 1 mot ; Récepteur place le curseur ; autres couples parient la direction
- [x] Scoring §6.4 (anneaux 4/3/2, paris +1/+2)
- [x] UI host (spectre + indice) + UI player (Émetteur / Récepteur / Parieur)
- [x] Stat `wavelengthAccuracy` alimentée
- [x] Seed : 12 questions wavelength (pôles)
- [ ] Catch-up (tour bonus dernier qui marque 4 pts) — non implémenté
- **Acceptation** : ✅ round Wavelength jouable, scoring testé (6 tests), e2e dédié, cible jamais fuitée.

### B2. Mode Mime D3 — Canal d'emojis (§8.3) ✅ ⏱️2j
Le plus simple des Mime (pas de caméra/DeviceMotion).
- [x] Plugin `mimeEmojiMode` : Donneur envoie ses emojis (cooldown serveur), Récepteur devine en texte libre, fuzzy match
- [x] Chaos bonus : autres couples devinent aussi (+points s'ils trouvent avant le Récepteur)
- [x] Stat `emojiHits` alimentée
- [x] Seed : 10 concepts + pool de 120 emojis
- **Acceptation** : ✅ round emoji jouable, fuzzy-match testé (8 tests), scoring testé (5), e2e dédié, secret jamais fuité.

### B3. Mécaniques anti-décrochage (§10.3) ⬜ ⏱️1j
- [ ] Leader du round → handicap secret au suivant ; dernier → bonus secret
- [ ] Champ `handicap` déjà présent dans le modèle → l'exploiter
- **Acceptation** : handicap/bonus appliqués et affichés, configurables.

### B4. Selfie-réactions + scrapbook (§8 / §10.3) ⬜ ⏱️2j
- [ ] `getUserMedia` avec consentement explicite + opt-out par joueur (fallback : jeu sans capture)
- [ ] Burst photo au reveal d'un match/mismatch notable → grille sur la TV
- [ ] Album souvenir de session exportable (dessins/citations/selfies)
- **Acceptation** : caméra refusée = jeu continue sans capture (testé) ; album exporté.

---

## JALON C — v1.2 : modes avancés & scalabilité

### C1. Mime D1 (Doodle) & D2 (Téléphone-front) (§8.1/8.2) ⬜ ⏱️3.5j
- [ ] D1 : canvas tactile, trait live sur TV, vote du plus drôle
- [ ] D2 : DeviceMotion (tilt) **avec fallback boutons obligatoire** (§10.1), caméra frontale clip 5s
- [ ] Permissions gesture-gated au lobby (§4.4) : DeviceMotion (iOS), caméra
- **Acceptation** : DeviceMotion refusé → boutons tactiles fonctionnent (testé §14).

### C2. Mode hostless (§1.4) ⬜ ⏱️2j
- [ ] Si aucune TV : le téléphone hôte devient écran public par roulement entre rounds
- **Acceptation** : partie complète jouable sans écran TV.

### C3. Mode « Pimenté » + titre Piquants du Salon (§9.2 #4) ⬜ ⏱️1j
- [ ] Toggle de room activant les questions `spicy`
- **Acceptation** : titre #4 atteignable, quota deep toujours respecté.

### C4. Persistance & scalabilité ⬜ ⏱️2j
- [ ] `RedisRoomStore` derrière l'interface `RoomStore` existante
- [ ] Adapter Socket.io Redis pour multi-instance
- **Acceptation** : 2 instances Node partagent l'état d'une room.

---

## JALON D — Production durable (transverse, en continu)

### D1. Contenu ⬜ ⏱️continu
- [ ] Atteindre ~40 noms × 40 adjectifs (déjà ok), ~60 métaphores (4 paliers)
- [ ] 30+ questions par mode, tags `daily/future/desire` équilibrés
- [ ] Relecture éditoriale (ton bienveillant, aucun titre blessant)

### D2. Observabilité & exploitation ⬜ ⏱️1j
- [ ] Logs structurés, métriques (rooms actives, latence), `/healthz` déjà présent
- [ ] Sentry (ou équiv.) côté client/serveur
- [ ] Sauvegarde anonyme des stats de fin (opt-in) pour équilibrage

### D3. Qualité continue ⬜ ⏱️0.5j
- [ ] Lint (ESLint + Prettier) ajouté à la CI
- [ ] Couverture de code mesurée, seuil minimal
- [ ] Test e2e navigateur (Playwright) sur le parcours hôte+joueur

### D4. Conformité ⬜ ⏱️1j
- [ ] Mentions RGPD (caméra, partage), politique de confidentialité
- [ ] Consentements explicites tracés

---

## Récapitulatif des priorités

| Ordre | Jalon | Effort | Débloque |
|---|---|---|---|
| **1** | A — Durcir & déployer le MVP | ~4.5j | **Jouable en vrai + en ligne** |
| 2 | B — v1.1 (Wavelength, Emoji, anti-décrochage, selfies) | ~7.5j | Variété de jeu |
| 3 | C — v1.2 (Mime D1/D2, hostless, pimenté, Redis) | ~8.5j | Complétude spec + scale |
| 4 | D — Production durable | continu | Pérennité |

**Recommandation** : finir **entièrement le Jalon A** (le jeu doit tourner sur
`couplewar.estim.pro` avec de vrais téléphones) **avant** d'ajouter le moindre mode.
Un MVP solide et déployé vaut mieux qu'un v1.2 instable.

---

## Prochaine action concrète proposée

Si tu valides, j'attaque le **Jalon A** dans cet ordre :
1. A3 (robustesse de partie : contrôles hôte + couple vide) — *codable tout de suite*
2. A4 (accessibilité/UX mobile) — *codable tout de suite*
3. A1/A2 (déploiement + tests terrain) — *nécessitent ton VPS / tes appareils*

Les points A1/A2 demandent un accès que je n'ai pas (VPS, téléphones) : je peux
préparer des scripts/checklists, mais c'est toi qui les exécutes. Dis-moi par quoi
commencer.
