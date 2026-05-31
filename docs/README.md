# Documentation joueur

## Guide de jeu (PDF)

[`CoupleWar_Guide.pdf`](./CoupleWar_Guide.pdf) — guide d'onboarding et d'explication
des jeux, à imprimer ou à partager avant une soirée :

- Le principe en 30 secondes, les trois écrans (TV / téléphone / serveur)
- Installation & lancement pas à pas
- Déroulé d'une manche
- Règles détaillées de chaque jeu (Sync, Enchères) avec le barème
- Classement, fin de partie (titres / médailles / %), FAQ

### Régénérer le PDF

Le guide est **généré depuis la config centralisée** (`config/game.config.json`),
donc tous les chiffres (durées, multiplicateurs, bonus, plancher de compatibilité…)
restent automatiquement synchronisés avec le jeu. Après toute modification de règle :

```bash
npm run guide      # produit docs/CoupleWar_Guide.pdf
```

Le générateur vit dans [`scripts/generate-guide.mjs`](../scripts/generate-guide.mjs).
Quand un nouveau mode est branché (Wavelength, Mime…), ajouter sa carte dans ce
script et relancer la commande.
