// Postinstall : sur macOS (surtout Apple Silicon), le binaire Electron
// téléchargé peut avoir une signature de code invalide (extraction partielle,
// attributs de quarantaine, etc.). macOS tue alors le process au SIGKILL.
// Ce script retire la quarantaine et re-signe l'app en ad-hoc.
// No-op sur les autres OS.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

if (process.platform !== "darwin") {
  process.exit(0);
}

const require = createRequire(import.meta.url);
let appPath;
try {
  // electron exporte le chemin de l'exécutable ; on remonte au .app
  const binPath = require("electron"); // .../Electron.app/Contents/MacOS/Electron
  appPath = binPath.split("/Contents/MacOS/")[0];
} catch {
  console.warn("[fix-electron-macos] module electron introuvable, on saute.");
  process.exit(0);
}

if (!appPath || !existsSync(appPath)) {
  console.warn(`[fix-electron-macos] Electron.app introuvable (${appPath}), on saute.`);
  process.exit(0);
}

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "pipe" });
    return true;
  } catch (e) {
    console.warn(`[fix-electron-macos] ${cmd} a échoué : ${e.message}`);
    return false;
  }
}

console.log(`[fix-electron-macos] Réparation de ${appPath}`);
run("xattr", ["-dr", "com.apple.quarantine", appPath]);
if (run("codesign", ["--force", "--deep", "--sign", "-", appPath])) {
  console.log("[fix-electron-macos] Electron re-signed (ad-hoc).");
}
