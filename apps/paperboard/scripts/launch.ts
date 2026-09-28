// Dev launcher: runs electron-vite with ELECTRON_RUN_AS_NODE removed.
//
// `electron-vite dev` spawns the Electron binary, and Electron obeys an
// inherited ELECTRON_RUN_AS_NODE=1 by running as plain Node. Electron-based
// terminals (VS Code, T3 Code) set that variable, so without this wrapper
// `bun run dev` dies immediately with "electron.app is undefined".
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { electronChildEnv } from "./launchEnv";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const shim = join(appDir, "node_modules", ".bin", isWindows ? "electron-vite.cmd" : "electron-vite");
if (!existsSync(shim)) {
    console.error(`electron-vite is not installed at ${shim}. Run bun install first.`);
    process.exit(1);
}

const child = spawn(shim, process.argv.slice(2), {
    cwd: appDir,
    stdio: "inherit",
    env: electronChildEnv(process.env),
    shell: isWindows,
});
child.on("error", (err) => {
    console.error(`Could not start electron-vite: ${err.message}`);
    process.exit(1);
});
child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
});
