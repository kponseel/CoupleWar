# A1 — Checklist de déploiement Hostinger (`couplewar.estim.pro`)

> À exécuter **toi-même** sur le VPS (je n'y ai pas accès). Coche au fur et à mesure.
> Réfère-toi au `README.md` (section déploiement) pour le détail de chaque commande.

## Pré-requis
- [ ] VPS Hostinger (KVM, Ubuntu 22.04+) provisionné, accès SSH root
- [ ] Domaine `couplewar.estim.pro` → enregistrement DNS A pointant vers l'IP du VPS
      (vérifier : `dig +short couplewar.estim.pro` renvoie l'IP)

## Installation
- [ ] `apt update && apt install -y nginx nodejs npm certbot python3-certbot-nginx git`
      (Node ≥ 20 ; sinon NodeSource)
- [ ] `node -v` ≥ 20
- [ ] Cloner le repo dans `/opt/couplewar` (ou ton chemin)
- [ ] `npm ci` à la racine
- [ ] `npm run build` (génère `server/dist`, `client/dist`, `packages/shared/dist`)

## Service Node (systemd ou PM2)
- [ ] Copier/adapter `deploy/couplewar.service` → `/etc/systemd/system/`
- [ ] Variables d'env : `PORT=3001`, `SERVE_STATIC=true`, `NODE_ENV=production`,
      `CORS_ORIGIN=https://couplewar.estim.pro`
- [ ] `systemctl enable --now couplewar`
- [ ] `systemctl status couplewar` → **active (running)**
- [ ] `curl -s localhost:3001/healthz` → `{"ok":true,...}`

## Nginx + HTTPS
- [ ] Copier/adapter `deploy/nginx.couplewar.conf` → `/etc/nginx/sites-available/`,
      lien dans `sites-enabled`
- [ ] Vérifier le bloc `location /socket.io/` (upgrade WebSocket : `proxy_set_header
      Upgrade $http_upgrade; Connection "upgrade"`)
- [ ] `nginx -t` OK, `systemctl reload nginx`
- [ ] `certbot --nginx -d couplewar.estim.pro` → certificat délivré
- [ ] Redirection HTTP→HTTPS active

## Validation fonctionnelle
- [ ] `https://couplewar.estim.pro` charge l'app (offline shell + manifest PWA)
- [ ] Ouvrir la console réseau : la connexion `wss://couplewar.estim.pro/socket.io/`
      s'établit (status 101 Switching Protocols)
- [ ] Créer une room sur un écran, rejoindre depuis un téléphone → le lobby se met à jour
- [ ] Jouer **une partie complète** (2 couples min) de bout en bout
- [ ] Tester une coupure réseau d'un joueur (mode avion 10 s) → reconnexion sans casser

## Exploitation
- [ ] Logs : `journalctl -u couplewar -f` (ou `pm2 logs`)
- [ ] Redémarrage auto au reboot (`systemctl is-enabled couplewar`)
- [ ] (Optionnel) UFW : autoriser 80/443, fermer 3001 à l'extérieur

## En cas de souci
| Symptôme | Piste |
|---|---|
| 502 Bad Gateway | service Node non démarré → `systemctl status couplewar` |
| WebSocket ne se connecte pas | bloc `location /socket.io/` Nginx (headers Upgrade) |
| Page blanche | `client/dist` non buildé ou `SERVE_STATIC` ≠ true |
| CORS refusé | `CORS_ORIGIN` ≠ domaine HTTPS exact |
| Certbot échoue | DNS pas encore propagé / port 80 fermé |
