// Lanceur Electron robuste.
// Certains environnements (notamment le terminal intégré de VS Code / Cursor)
// exportent ELECTRON_RUN_AS_NODE=1, ce qui fait démarrer Electron en simple
// process Node au lieu du mode application (app === undefined, crash au boot).
// On retire la variable puis on lance Electron proprement.
import { spawn } from "node:child_process";
import electronPath from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("close", (code) => process.exit(code ?? 0));
