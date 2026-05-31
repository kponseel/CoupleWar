# A2 — Checklist de tests sur appareils réels (§14)

> À exécuter sur de **vrais téléphones** (au moins 1 iPhone + 1 Android), idéalement
> en conditions de soirée (plusieurs personnes, wifi/4G). Je ne peux pas l'automatiser :
> ce sont des vérifications terrain.

## Matériel de test recommandé
- [ ] 1 écran TV/laptop (hôte) + au moins 4 téléphones (2 couples)
- [ ] Mélange iOS (Safari) + Android (Chrome)
- [ ] Au moins une session sur 4G (pas seulement wifi)

## Synchro d'horloge (le cœur, §3)
- [ ] L'offset se calibre au lobby (pas d'attente anormale au démarrage)
- [ ] En mode Sync, les deux partenaires voient la question **en même temps** (à l'œil)
- [ ] Le bonus « Cœur Battant » se déclenche quand les deux répondent quasi simultanément
- [ ] Reste fiable sur 4G dégradée (latence 200 ms+) : pas de scores aberrants

## Wake Lock (§10.1)
- [ ] L'écran reste allumé pendant une manche sans toucher l'écran
- [ ] Survit à un lock/unlock manuel (verrouiller puis déverrouiller → reste actif)
- [ ] iOS 16.4+ : confirmer que le Wake Lock est bien acquis (sinon fallback accepté)

## Audio (§10.1)
- [ ] Le son se débloque au **premier tap** sur iOS (pas de silence permanent)
- [ ] Le drumroll des enchères est audible
- [ ] Le sting du flash collectif joue sur tous les écrans
- [ ] En mode silencieux iOS : pas de crash (TTS peut être muet, c'est OK)

## Réseau & reconnexion (§14)
- [ ] Mode avion 10 s sur un téléphone en pleine manche → reconnexion auto, retrouve la phase
- [ ] Fermer/rouvrir l'onglet → reprend la session (même room, même couple)
- [ ] Si la partie est finie/expirée au retour → message clair, retour à l'accueil
- [ ] Bandeau « Reconnexion… » s'affiche quand le réseau coupe

## Anti-blocage (§A3)
- [ ] Un joueur ne répond pas → le round se termine seul au timeout
- [ ] L'hôte peut cliquer « ⏭️ Révéler maintenant » pour ne pas attendre

## PWA & affichage
- [ ] Installable (icône ajoutée à l'écran d'accueil), s'ouvre en `standalone`
- [ ] Pas de débordement / texte coupé sur petit écran (≤ 360px de large)
- [ ] L'encoche iOS ne masque pas de contenu (safe-area OK)
- [ ] Le clavier mobile (saisie nom/enchères) ne cache pas le bouton de validation

## Accessibilité (§A4)
- [ ] Lighthouse (Chrome DevTools, mode mobile) : score **PWA ≥ 90**, **Accessibilité ≥ 90**
- [ ] Navigation au clavier : focus visible sur les boutons
- [ ] `prefers-reduced-motion` activé → animations réduites, jeu toujours jouable

## Robustesse de contenu
- [ ] Sur une partie complète : quota `deep ≤ 2` respecté (pas plus de 2 questions intimes)
- [ ] Tous les couples reçoivent un titre + une médaille à la fin
- [ ] Le % de compatibilité n'est jamais < 67

---

### Remontée des résultats
Note ici les écarts constatés (modèle de téléphone, OS, symptôme) pour que je corrige :

| Appareil / OS | Test | Résultat | Note |
|---|---|---|---|
|  |  |  |  |
