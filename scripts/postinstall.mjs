// postinstall : build automatique pour les hébergeurs qui lancent seulement
// `npm install` puis le startup file (ex. Hostinger Node.js), SANS étape de build
// dédiée. Garde-fou : si les outils de build (devDependencies) sont absents
// (install en --omit=dev) ou si COUPLEWAR_SKIP_POSTINSTALL=1, on ne fait rien —
// l'install ne casse jamais.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

if (process.env.COUPLEWAR_SKIP_POSTINSTALL === "1") {
  console.log("[postinstall] ignoré (COUPLEWAR_SKIP_POSTINSTALL=1)");
  process.exit(0);
}

// Les outils de build sont-ils disponibles ? (typescript + vite)
function hasBuildTools() {
  try {
    require.resolve("typescript/package.json");
    require.resolve("vite/package.json");
    return true;
  } catch {
    return false;
  }
}

if (!hasBuildTools()) {
  console.log("[postinstall] outils de build absents (install --omit=dev ?) → build sauté.");
  process.exit(0);
}

try {
  console.log("[postinstall] build de l'application (shared + server + client)…");
  execSync("npm run build", { stdio: "inherit" });
  console.log("[postinstall] build terminé.");
} catch (err) {
  console.error("[postinstall] échec du build:", err?.message ?? err);
  // On NE casse PAS l'install : l'hébergeur peut avoir une étape de build dédiée.
  process.exit(0);
}
