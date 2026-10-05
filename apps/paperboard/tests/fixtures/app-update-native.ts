import { app } from "electron";
import { NsisUpdater, MacUpdater } from "electron-updater";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor";
import { AppUpdateSession } from "../../src/main/appUpdateSession";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
// NSIS relaunches through Explorer, which drops the launching shell's env.
// The fixture install directory is inside its explicit temporary test root.
const root = process.env.PB_UPDATE_TEST_ROOT ?? path.dirname(path.dirname(process.execPath));
if (!path.basename(root).startsWith("pb-updater-")) throw new Error("PB_UPDATE_TEST_ROOT must name isolated test resources");
fs.mkdirSync(path.join(root, "userData"), { recursive: true });
fs.mkdirSync(path.join(root, "logs"), { recursive: true });
app.setPath("userData", path.join(root, "userData"));
app.setPath("logs", path.join(root, "logs"));
const log = (text: string) => fs.appendFileSync(path.join(root, "native.log"), text + "\n");
process.on("uncaughtException", (error) => { log(error.stack || String(error)); app.exit(1); });
app.whenReady().then(async () => {
    log(`START ${process.platform} Electron=${process.versions.electron} version=${app.getVersion()} exec=${process.execPath}`);
    if (app.getVersion() === "0.1.1") {
        fs.writeFileSync(path.join(root, "activated.json"), JSON.stringify({ version: app.getVersion(), behavior: "new-release-ready", executable: process.execPath }));
        app.quit(); return;
    }
    const artifact = path.join(root, process.platform === "win32" ? "update.exe" : "update.zip");
    const stat = fs.statSync(artifact);
    const digest = await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash("sha512");
        const stream = fs.createReadStream(artifact);
        stream.on("error", reject); stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("base64")));
    });
    let scenario = "missing-feed";
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
        requests.push(`${scenario} ${req.url}`);
        if (req.url?.includes(".yml")) {
            if (scenario === "missing-feed") { res.writeHead(404); res.end("No release"); return; }
            const checksum = scenario === "corrupt" ? Buffer.alloc(64).toString("base64") : digest;
            const name = process.platform === "win32" ? "update.exe" : "update.zip";
            res.end(`version: 0.1.1\nfiles:\n  - url: ${name}\n    sha512: ${checksum}\n    size: ${stat.size}\npath: ${name}\nsha512: ${checksum}\nreleaseDate: '2026-10-05T00:00:00Z'\n`);
        } else if (req.url === "/update.exe" || req.url === "/update.zip") {
            res.writeHead(200, { "Content-Length": stat.size });
            const stream = fs.createReadStream(artifact); stream.pipe(res);
            res.on("close", () => stream.destroy());
        } else { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    const results: unknown[] = [];
    let successfulUpdater: any = null;
    try {
        for (const test of ["missing-feed", "corrupt", "valid"]) {
            scenario = test;
            const configPath = path.join(root, `${test}.yml`);
            fs.writeFileSync(configPath, `provider: generic\nurl: http://127.0.0.1:${port}\nupdaterCacheDirName: ${test}\n`);
            const adapter = {
                whenReady: () => app.whenReady(), version: "0.1.0", name: "PaperboardUpdaterFixture", isPackaged: true,
                appUpdateConfigPath: configPath, userDataPath: path.join(root, "userData"), baseCachePath: path.join(root, "cache", test),
                quit: () => app.quit(), relaunch: () => app.relaunch(), onQuit: (handler: any) => app.once("quit", handler),
            };
            const updater: any = process.platform === "win32" ? new NsisUpdater(undefined, adapter) : new MacUpdater(undefined, adapter);
            updater.httpExecutor = new ElectronHttpExecutor();
            updater.autoDownload = true; updater.autoInstallOnAppQuit = false; updater.disableDifferentialDownload = true;
            updater.logger = { info: (...args: any[]) => log(args.join(" ")), warn: (...args: any[]) => log(args.join(" ")), error: (...args: any[]) => log(args.join(" ")), debug: (...args: any[]) => log(args.join(" ")) };
            const states: unknown[] = [];
            const session = new AppUpdateSession(updater, (state) => { states.push(state); log(JSON.stringify({ test, state })); }, 120_000);
            const result = await session.check();
            results.push({ test, result, states });
            // This is a separate fixture app id and install dir. Never let
            // an updater fixture write the user's real install or data.
            if (test === "valid" && result.status === "ready") successfulUpdater = updater;
            session.dispose();
        }
        fs.writeFileSync(path.join(root, "results.json"), JSON.stringify({ platform: process.platform, electron: process.versions.electron, results, requests }, null, 2));
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    if (successfulUpdater && process.platform === "win32") {
        successfulUpdater.installDirectory = path.dirname(process.execPath);
        log(`INSTALL ${successfulUpdater.installDirectory}`);
        successfulUpdater.quitAndInstall(true, true);
    } else { app.quit(); }
}).catch((error) => { log(error.stack || String(error)); app.exit(1); });
