# Déploiement sur l'hébergement Node.js Hostinger (`couplewar.estim.pro`)

> Pour l'**hébergement Web Hostinger avec gestionnaire Node.js** (pas un VPS).
> Une SEULE application : le serveur Express sert à la fois l'API, le WebSocket
> ET le front React buildé. Une seule URL, WebSocket same-origin.

## 0. Pré-requis
- Le code est sur la branche **`main`** du repo GitHub (fait).
- Domaine/ sous-domaine `couplewar.estim.pro` géré dans Hostinger.

## 1. Créer l'application Node.js (hPanel → Node.js → Créer une application)

| Champ | Valeur |
|---|---|
| **Version de Node.js** | `22.x` (ou 20.x) |
| **Gestionnaire de paquets** | `npm` |
| **Dépôt / source** | le repo GitHub `kponseel/CoupleWar`, branche **`main`** |
| **Application root** (racine) | la racine du repo (là où se trouve le `package.json` principal) |
| **Startup file** (fichier de démarrage) | `server/dist/index.js` |
| **Build command** (si demandé) | `npm install` *(le build se déclenche automatiquement via `postinstall`)* |

> ℹ️ Le `postinstall` du projet lance `npm run build` (compile shared + serveur +
> front React). Si Hostinger propose un champ « Build command » séparé, mets
> `npm install && npm run build` ; sinon `npm install` suffit.

## 2. Variables d'environnement (onglet « Variables » de l'app)

| Variable | Valeur | Pourquoi |
|---|---|---|
| `NODE_ENV` | `production` | active le mode prod |
| `SERVE_STATIC` | `true` | le serveur sert le front React buildé (`client/dist`) |
| `HOST` | `0.0.0.0` | écoute sur toutes les interfaces |
| `CORS_ORIGINS` | `https://couplewar.estim.pro` | autorise le front (same-origin) |

> ⚠️ **Ne définis PAS `PORT`** : Hostinger injecte son propre port, le serveur
> le lit automatiquement (`process.env.PORT`).

## 3. Domaine
- Associe `couplewar.estim.pro` à l'application Node.js (Hostinger gère le HTTPS/SSL
  automatiquement pour les domaines hébergés chez lui).
- Vérifie que l'URL ouvre bien en `https://` (obligatoire pour la PWA, le Wake Lock,
  la caméra).

## 4. Démarrer et vérifier
1. Lance l'application depuis hPanel (Start / Restart).
2. **Healthcheck** : ouvre `https://couplewar.estim.pro/healthz`
   → doit afficher `{"ok":true,"configVersion":"1.0.0"}`.
3. **Front** : ouvre `https://couplewar.estim.pro/` → l'écran d'accueil CoupleWar.
4. **WebSocket** (le point critique) : ouvre la console du navigateur (F12) →
   onglet Réseau → filtre `socket.io`. Tu dois voir une connexion qui passe en
   **`101 Switching Protocols`** (vrai WebSocket) OU des requêtes `polling` qui
   répondent `200` (repli automatique — le jeu marche quand même).

## 5. Test grandeur nature
- Ouvre l'app sur un écran (« Lancer sur la TV »), note le code à 4 lettres.
- Rejoins depuis 1 ou 2 téléphones, forme un couple.
- Utilise le bouton **« 🧪 Lancer en solo »** pour tester à 1 couple.
- Joue une manche : si les réponses arrivent en temps réel sur la TV → **le
  WebSocket fonctionne**, tout est bon. 🎉

## En cas de souci

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche, healthz OK | front pas buildé | vérifier que `client/dist` existe (logs du build / `postinstall`) ; relancer un déploiement |
| `Cannot find module server/dist/index.js` | build non exécuté | mettre le build command à `npm install && npm run build` |
| App crash au démarrage : « Config invalide » | `config/game.config.json` absent du déploiement | vérifier que le dossier `config/` est bien déployé (il l'est par défaut) |
| Les réponses n'arrivent pas en temps réel | WebSocket **et** polling bloqués | rare ; contacter le support Hostinger pour activer le WebSocket, ou basculer sur un VPS |
| CORS error en console | `CORS_ORIGINS` ≠ domaine exact | mettre exactement `https://couplewar.estim.pro` |

## Mises à jour ultérieures
Pousse sur `main` → redéploie l'application depuis hPanel (re-`npm install` →
`postinstall` rebuild). C'est tout.
