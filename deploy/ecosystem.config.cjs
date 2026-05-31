// CoupleWar — alternative PM2 au service systemd.
//   npm i -g pm2
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup     # démarrage auto au boot
//   pm2 logs couplewar
module.exports = {
  apps: [
    {
      name: "couplewar",
      script: "server/dist/index.js",
      cwd: "/var/www/couplewar",
      instances: 1, // état in-memory par room → 1 instance (Redis adapter requis pour scaler)
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        HOST: "127.0.0.1",
        SERVE_STATIC: "true",
        CORS_ORIGINS: "https://couplewar.estim.pro",
      },
    },
  ],
};
