// ensureElectron: make the Electron runtime binary present after a fresh
// dependency install.
//
// electron 44 stopped shipping its own postinstall; the binary is now fetched
// lazily only when `require('electron')` or the electron CLI runs. electron-vite
// (used by `bun run dev` and `bun run start`) instead reads
// node_modules/electron/path.txt directly and throws "Electron uninstall" when
// it is absent, so a fresh `bun install` leaves the app unable to start. This
// module runs electron's own installer at the point the dev bootstrap needs it.
//
// Kept separate from dev.ts so the "is the binary present?" contract is
// unit-tested (ensureElectron.test.ts) without downloading a binary.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ElectronInstallState {
    installed: boolean;
    reason: string;
}

// Mirrors electron's install.js isInstalled and electron-vite's getElectronPath:
// path.txt points at the executable inside dist/, and dist/version must match
// the package version. Both are the markers those consumers require.
export function electronInstallState(electronDir: string, expectedVersion: string): ElectronInstallState {
    const pathFile = join(electronDir, "path.txt");
    if (!existsSync(pathFile)) return { installed: false, reason: "path.txt is missing" };
    const versionFile = join(electronDir, "dist", "version");
    if (!existsSync(versionFile)) return { installed: false, reason: "dist/version is missing" };
    const version = readFileSync(versionFile, "utf8").trim().replace(/^v/, "");
    if (version !== expectedVersion) {
        return { installed: false, reason: `dist/version is ${version}, expected ${expectedVersion}` };
    }
    const executable = readFileSync(pathFile, "utf8").trim();
    if (!existsSync(join(electronDir, "dist", executable))) {
        return { installed: false, reason: `dist/${executable} is missing` };
    }
    return { installed: true, reason: "up to date" };
}

// Runs electron's bundled installer when the binary is absent, then re-reads
// the state so a silent no-op cannot be mistaken for success.
export function ensureElectron(electronDir: string, expectedVersion: string): void {
    const state = electronInstallState(electronDir, expectedVersion);
    if (state.installed) {
        console.log(`electron ${expectedVersion} already present (${state.reason})`);
        return;
    }
    const installer = join(electronDir, "install.js");
    if (!existsSync(installer)) {
        throw new Error(`electron binary is missing (${state.reason}) and no installer at ${installer}`);
    }
    console.log(`electron ${expectedVersion} binary missing (${state.reason}); installing...`);
    const result = spawnSync(process.execPath, [installer], { cwd: electronDir, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`electron install.js failed (exit ${result.status ?? "signal"})`);
    }
    const after = electronInstallState(electronDir, expectedVersion);
    if (!after.installed) {
        throw new Error(`electron binary still missing after install.js: ${after.reason}`);
    }
}
