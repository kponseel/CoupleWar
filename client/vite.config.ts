import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA installable (§ brief / §10.1) : standalone + service worker + offline shell.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/icon.svg"],
      manifest: {
        name: "CoupleWar",
        short_name: "CoupleWar",
        description: "Party game multi-écrans : couple vs couple, en temps réel.",
        theme_color: "#0b0b16",
        background_color: "#0b0b16",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Offline shell : précache l'app. Les sockets restent en ligne (temps réel).
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/socket\.io/, /^\/api/, /^\/healthz/],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // En dev, proxy le WebSocket vers le serveur Node (autorité).
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true, changeOrigin: true },
      "/healthz": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
