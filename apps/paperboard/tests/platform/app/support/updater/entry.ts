// Electron main for the updater smoke: the app's own updater
// (platformUpdater.ts behind appUpdateSession.ts, as updater.ts wires them)
// pointed at a loopback feed. It runs one check, or several at once, and
// writes what happened to PB_UPDATER_RESULT. No window is ever created.
import * as fs from "node:fs";
import { app } from "electron";
import { createPlatformUpdater } from "../../../../../src/main/platformUpdater";
import { AppUpdateSession } from "../../../../../src/main/appUpdateSession";
import type { AppUpdateState } from "../../../../../src/shared/appUpdate";

interface Scenario {
    cacheDir: string;
    resultFile: string;
    concurrent: number;
    timeoutMs: number;
}

const scenario: Scenario = JSON.parse(process.env.PB_UPDATER ?? "null");
if (!scenario) throw new Error("PB_UPDATER is not set");

void app.whenReady().then(async () => {
    const log: Array<{ level: string; message: string }> = [];
    const states: AppUpdateState[] = [];
    let session: AppUpdateSession | null = null;
    try {
        const updater = createPlatformUpdater(scenario.cacheDir);
        updater.logger = {
            info: (m: unknown) => log.push({ level: "info", message: String(m) }),
            warn: (m: unknown) => log.push({ level: "warn", message: String(m) }),
            error: (m: unknown) => log.push({ level: "error", message: String(m) }),
            debug: (m: unknown) => log.push({ level: "debug", message: String(m) }),
        } as never;
        updater.autoDownload = true;
        // the downloaded test bytes are not an installer: never run them on exit
        updater.autoInstallOnAppQuit = false;
        // an unpackaged app reads dev-app-update.yml (run.ts writes it the
        // way electron-builder writes the packaged app-update.yml)
        updater.forceDevUpdateConfig = true;
        session = new AppUpdateSession(updater, (state) => states.push(state), scenario.timeoutMs);
        const runs = Array.from({ length: scenario.concurrent }, () => session!.check());
        const results = await Promise.all(runs);
        fs.writeFileSync(scenario.resultFile, JSON.stringify({ results, shared: runs.every((r) => r === runs[0]), states, log }));
        session.dispose();
        app.exit(0);
    } catch (err) {
        fs.writeFileSync(scenario.resultFile, JSON.stringify({ crashed: (err as Error)?.stack ?? String(err), states, log }));
        session?.dispose();
        app.exit(1);
    }
});
