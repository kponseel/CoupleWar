# Config centralisée — `game.config.json`

Source de vérité unique pour **toutes les valeurs chiffrées** du jeu (§11 de la spec).
Aucune de ces valeurs ne doit être codée en dur dans le code métier : le serveur
charge ce fichier au démarrage, le valide (zod), et le diffuse aux clients via les
événements socket. Le client n'a jamais sa propre copie « en dur ».

- **Format** : JSONC (JSON + commentaires `//` et `/* */`). Les commentaires sont
  strippés au chargement (`packages/shared/src/jsonc.ts`). Tu peux donc documenter
  chaque valeur directement dans le fichier.
- **Versionné** : `configVersion` suit les changements de règles. Toute modification
  de règle ou de barème passe par ici et est committée.
- **Chemin** : par défaut `config/game.config.json` à la racine. Surchargé par la
  variable d'environnement `COUPLEWAR_CONFIG_PATH` (utile en déploiement).

## Sections

| Clé | Spec | Rôle |
|---|---|---|
| `room` | §4.1 | min/max couples, longueur du code de partie. |
| `sync` | §5.3 | barème Mode Sync : base, match ×2.5, Cœur Battant, streak. |
| `wavelength` | §6 | barème Mode Wavelength (présent, branché v1.1). |
| `auction` | §7.3 | barème Mode Enchères : jetons, multiplicateur, jackpot Devineur. |
| `mime` | §8 | barème Mode Mime (présent, branché v1.2). |
| `results` | §9.4 | plancher de compatibilité (67) + pondérations du %. |
| `tone` | §2 | quota `deep ≤ 2` par partie, ratio fun/vulnérable. |
| `reveal` | §10.2 | durées exactes des FX synchronisés (drumroll/freeze/flash). |
| `finale` | §2 | multiplicateur du dernier round (×2.5). |
| `clock` | §3.2 | paramètres du mini-NTP (nb d'échantillons, intervalle). |
| `network` | §14 | fenêtre de grâce de reconnexion. |
| `roundPlan` | §2/§13 | séquence de rounds du MVP (modes branchés). |
| `introMs` / `interludeMs` / `leaderboardRowPauseMs` | §5.2/§10.3 | timings d'écran. |

## Étendre la séquence de rounds

`roundPlan` est une liste ordonnée. Chaque entrée :

```jsonc
{ "mode": "sync", "intensityMax": "medium", "finale": true }
```

- `mode` : un mode **branché** (`sync`, `auction` au MVP).
- `intensityMax` : intensité max des questions piochées pour ce round (`light|medium|deep`).
- `finale` (optionnel) : applique `finale.scoreMultiplier`.

Le moteur respecte le quota `tone.maxDeepQuestionsPerGame` sur l'ensemble de la partie,
quel que soit le plan.
