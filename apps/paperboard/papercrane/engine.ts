// Core execution engine for PaperCrane (terminals, processes, files,
// packages, panels, configs). Storage/download/manifest logic lives in
// ./storage so it stays byte-identical with the Electron-side drivers.

import path from "path";
import fs from "fs";
import os from "os";
import * as tar from "tar";
import { SupervisedProcessClient, getSupervisorSocketPath } from "./supervisor";
import { PanelManifest } from "./types";
import {
    ProgressCallback,
    streamToFileWithProgress,
    moveFileSafe,
    makeSafeTarFilter,
    resolveSecureTargetPath,
    sanitizeId,
    validatePanelManifest,
    writeJsonAtomicSync,
    writeFileAtomic,
} from "./storage";
import { getSocketsDir, getPaperboardDir } from "./paths";
import { logger } from "./logger";
import { spawnSupervisedClient } from "./engineSupervisor";
import { extractArchive, findBinDir } from "./engineArchives";

export const REGISTRY_URL =
    process.env.ORIGAMI_REGISTRY_URL || "https://origami.ariapis.com";

// Core execution engine for PaperCrane (terminals, processes, files, packages, panels, configs)
export class PaperCraneEngine {
    private appDataDir: string;
    private packagesDir: string;
    private filesDir: string;
    private panelsDir: string;
    private configsDir: string;
    private clients = new Map<string, SupervisedProcessClient>();

    constructor(baseDir?: string) {
        this.appDataDir = baseDir || getPaperboardDir();
        this.packagesDir = path.join(this.appDataDir, "packages");
        this.filesDir = path.join(this.appDataDir, "files");
        this.panelsDir = path.join(this.appDataDir, "panels");
        this.configsDir = path.join(this.appDataDir, "configs");

        for (const dir of [
            this.appDataDir,
            this.packagesDir,
            this.filesDir,
            this.panelsDir,
            this.configsDir,
        ]) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }

        this.sweepOrphans();
    }

    // Removes interrupted download/install artifacts (*.tmp-*, *.staging-*).
    // These appear when a crash/restart interrupts a long operation.
    private sweepOrphans(): void {
        for (const dir of [this.packagesDir, this.panelsDir]) {
            try {
                for (const entry of fs.readdirSync(dir)) {
                    if (/\.(tmp|staging)-\d+/.test(entry)) {
                        fs.rmSync(path.join(dir, entry), {
                            recursive: true,
                            force: true,
                        });
                    }
                }
            } catch {}
        }
    }

    // Resolves a subpath in one of the managed directories
    public resolvePath(
        type: "panels" | "files" | "packages" | "configs",
        ...parts: string[]
    ): string {
        const base =
            type === "panels"
                ? this.panelsDir
                : type === "files"
                  ? this.filesDir
                  : type === "packages"
                    ? this.packagesDir
                    : this.configsDir;
        return path.join(base, ...parts);
    }

    // Resolves isolated files directory for a panel
    public resolveAppFilesDir(appId?: string): string {
        const cleanAppId = appId
            ? appId.replace(/[^a-zA-Z0-9_.-]/g, "_")
            : "default";
        const dir = path.join(this.filesDir, cleanAppId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    // Resolves path inside panel isolated storage preventing path traversal
    public resolveSecureTargetPath(targetPath: string, appId?: string): string {
        return resolveSecureTargetPath(this.filesDir, targetPath, appId);
    }

    // Terminal management
    public async createTerminal(
        id: string,
        cols: number = 80,
        rows: number = 24,
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void> {
        const shell =
            process.env.SHELL ||
            (process.platform === "win32" ? "powershell.exe" : "bash");
        const resolvedCwd = cwd
            ? path.resolve(cwd)
            : typeof os.homedir === "function"
              ? os.homedir()
              : process.cwd();

        await spawnSupervisedClient(
            id,
            {
                id,
                type: "pty",
                isPty: true,
                command: shell,
                args: [],
                cwd: resolvedCwd,
                env,
                cols,
                rows,
            },
            this.clients,
            { onData, onExit },
        );
    }

    public writeTerminal(id: string, data: string): void {
        this.clients.get(id)?.write(data);
    }

    public resizeTerminal(id: string, cols: number, rows: number): void {
        this.clients.get(id)?.resize(cols, rows);
    }

    public destroyTerminal(id: string): void {
        const client = this.clients.get(id);
        if (client) {
            client.kill("SIGTERM");
            client.destroy();
            this.clients.delete(id);
        }
    }

    private attachedTerminalCallbacks = new WeakMap<
        object,
        {
            onData?: (data: string) => void;
            onExit?: (code: number) => void;
        }
    >();

    // Reattaches event streaming for a terminal owned by a previous session
    // (used by clients reconnecting after daemon/app restarts).
    public async attachTerminal(
        id: string,
        onData?: (data: string) => void,
        onExit?: (code: number) => void,
    ): Promise<boolean> {
        let client = this.clients.get(id);
        if (!client) {
            if (!fs.existsSync(getSupervisorSocketPath(id))) return false;
            client = new SupervisedProcessClient(id);
            const ok = await client.connect();
            if (!ok) return false;
            this.clients.set(id, client);
        }

        const prev = this.attachedTerminalCallbacks.get(client);
        if (prev) {
            if (prev.onData) client.off("data", prev.onData);
            if (prev.onExit) client.off("exit", prev.onExit);
        }
        const current = { onData, onExit };
        this.attachedTerminalCallbacks.set(client, current);

        if (onData) client.on("data", onData);
        if (onExit) client.on("exit", onExit);
        return true;
    }

    public async isTerminalRunning(id: string): Promise<boolean> {
        let client = this.clients.get(id);
        if (!client && fs.existsSync(getSupervisorSocketPath(id))) {
            client = new SupervisedProcessClient(id);
            if (await client.connect()) this.clients.set(id, client);
        }
        return client?.isConnected() ?? false;
    }

    // Background supervised processes
    public async runProcess(
        id: string,
        command: string,
        args: string[] = [],
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
    ): Promise<{ exitCode: number }> {
        const resolvedCwd = cwd
            ? path.resolve(cwd)
            : typeof os.homedir === "function"
              ? os.homedir()
              : process.cwd();

        const exitPromise = new Promise<{ exitCode: number }>((resolve) => {
            spawnSupervisedClient(
                id,
                {
                    id,
                    type: "child_process",
                    command,
                    args,
                    cwd: resolvedCwd,
                    env,
                },
                this.clients,
                {
                    onData,
                    onStdout,
                    onStderr,
                    onExit: (exitCode: number) => {
                        this.clients.delete(id);
                        resolve({ exitCode });
                    },
                },
            );
        });

        return exitPromise;
    }

    public writeProcess(id: string, data: string): void {
        this.clients.get(id)?.write(data);
    }

    public killProcess(id: string, signal: string = "SIGTERM"): void {
        const client = this.clients.get(id);
        if (!client) return;
        this.clients.delete(id);

        client.kill(signal);

        // destroy() clears listeners, which would swallow the exit event and
        // leave clients waiting for it forever. Let the exit fire first.
        const teardown = () => client.destroy();
        client.on("exit", teardown);
        setTimeout(teardown, 5000);
    }

    public async isProcessRunning(id: string): Promise<boolean> {
        let client = this.clients.get(id);
        if (!client && fs.existsSync(getSupervisorSocketPath(id))) {
            client = new SupervisedProcessClient(id);
            if (await client.connect()) this.clients.set(id, client);
        }
        return client?.isConnected() ?? false;
    }

    // Last attach listeners per client, so a re-attach (panel reload,
    // transport reconnect) REPLACES them instead of stacking duplicates.
    private attachedProcessCallbacks = new WeakMap<
        object,
        {
            onData?: (data: string) => void;
            onStdout?: (data: string) => void;
            onStderr?: (data: string) => void;
            onExit?: (exitCode: number) => void;
        }
    >();

    public async attachProcess(
        id: string,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<boolean> {
        let client = this.clients.get(id);
        if (!client) {
            client = new SupervisedProcessClient(id);
            const ok = await client.connect();
            if (!ok) return false;
            this.clients.set(id, client);
        }

        const prev = this.attachedProcessCallbacks.get(client);
        if (prev) {
            if (prev.onData) client.off("data", prev.onData);
            if (prev.onStdout) client.off("stdout", prev.onStdout);
            if (prev.onStderr) client.off("stderr", prev.onStderr);
            if (prev.onExit) client.off("exit", prev.onExit);
        }
        const current = { onData, onStdout, onStderr, onExit };
        this.attachedProcessCallbacks.set(client, current);

        if (onData) client.on("data", onData);
        if (onStdout) client.on("stdout", onStdout);
        if (onStderr) client.on("stderr", onStderr);
        if (onExit) client.on("exit", onExit);

        return true;
    }

    // Panel file management
    public getFilePath(targetPath: string, appId?: string): string {
        return this.resolveSecureTargetPath(targetPath, appId);
    }

    // Deletes a file inside a panel's isolated storage. Refuses directories
    // and missing paths so a bad target can't escape or destroy broadly.
    public async deleteFile(
        targetPath: string,
        appId?: string,
    ): Promise<boolean> {
        const fullPath = this.resolveSecureTargetPath(targetPath, appId);
        if (!fs.existsSync(fullPath)) return false;
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile()) return false;
        await fs.promises.unlink(fullPath);
        return true;
    }

    public async fileExists(
        targetPath: string,
        appId?: string,
    ): Promise<boolean> {
        const fullPath = this.resolveSecureTargetPath(targetPath, appId);
        return fs.existsSync(fullPath);
    }

    public async writeFile(
        targetPath: string,
        content: string,
        appId?: string,
    ): Promise<string> {
        const fullPath = this.resolveSecureTargetPath(targetPath, appId);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await fs.promises.writeFile(fullPath, content, "utf-8");
        return fullPath;
    }

    public async readFile(
        targetPath: string,
        appId?: string,
    ): Promise<string | null> {
        const fullPath = this.resolveSecureTargetPath(targetPath, appId);
        if (!fs.existsSync(fullPath)) return null;
        return await fs.promises.readFile(fullPath, "utf-8");
    }

    public async clearFiles(appId?: string): Promise<boolean> {
        // The directory itself is removed too — callers expect a clean slate.
        const base = this.resolveAppFilesDir(appId);
        if (fs.existsSync(base)) {
            await fs.promises.rm(base, { recursive: true, force: true });
        }
        return true;
    }

    // Recovers running supervisor clients from previous daemon sessions
    public async recoverRunningSupervisors(): Promise<void> {
        const socketsDir = getSocketsDir();
        if (!fs.existsSync(socketsDir)) return;
        try {
            const files = await fs.promises.readdir(socketsDir);
            for (const file of files) {
                if (file.endsWith(".json")) {
                    const id = file.replace(/\.json$/, "");
                    if (!this.clients.has(id)) {
                        const client = new SupervisedProcessClient(id);
                        if (await client.connect()) {
                            this.clients.set(id, client);
                        }
                    }
                }
            }
        } catch (err) {
            logger.warn(
                "[PaperCrane] failed to recover running supervisors:",
                err,
            );
        }
    }

    // Shuts down every supervised client (background processes and PTYs)
    // owned by this daemon: SIGTERM first, escalating to SIGKILL after the
    // grace period. Prevents orphaned children outliving the daemon — e.g.
    // a Minecraft server holding its world lock while the app restarted.
    public async disposeClients(graceMs = 5000): Promise<void> {
        const entries = [...this.clients.entries()];
        if (entries.length === 0) return;

        for (const [, client] of entries) {
            try {
                client.kill("SIGTERM");
            } catch {}
        }

        const deadline = Date.now() + graceMs;
        while (Date.now() < deadline) {
            if (entries.every(([, client]) => !client.isConnected())) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        this.killAllClients();
    }

    // Synchronous last-resort teardown for process exit handlers where
    // waiting is not an option.
    public killAllClients(): void {
        for (const [id, client] of [...this.clients.entries()]) {
            try {
                if (client.isConnected()) client.kill("SIGKILL");
            } catch {}
            try {
                client.destroy();
            } catch {}
            this.clients.delete(id);
        }
    }

    public async downloadFile(
        url: string,
        targetPath: string,
        appId: string | undefined,
        _downloadId: string,
        options: {
            sha1?: string;
            sha256?: string;
            checksum?: { algorithm: string; value: string };
        } = {},
        onProgress?: ProgressCallback,
    ): Promise<string> {
        const finalDest = this.resolveSecureTargetPath(targetPath, appId);
        const tempPath = `${finalDest}.tmp-${Date.now()}`;
        const dir = path.dirname(finalDest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        try {
            await streamToFileWithProgress(
                url,
                tempPath,
                onProgress,
                options.sha1 ||
                    (options.checksum?.algorithm === "sha1"
                        ? options.checksum.value
                        : undefined),
                options.sha256 ||
                    (options.checksum?.algorithm === "sha256"
                        ? options.checksum.value
                        : undefined),
            );

            await moveFileSafe(tempPath, finalDest);
            onProgress?.({ stage: "completed", percent: 100 });
            return finalDest;
        } catch (err: any) {
            if (fs.existsSync(tempPath))
                await fs.promises.unlink(tempPath).catch(() => {});
            onProgress?.({ stage: "error", percent: 0, message: err.message });
            throw err;
        }
    }

    // Runtime package management
    public isPackageInstalled(packageName: string, _version?: string): boolean {
        const base = path.join(this.packagesDir, packageName);
        if (!fs.existsSync(base)) return false;
        return this.findBinDir(base, 4) !== null;
    }

    public getPackageIndex(): Record<string, any> {
        const indexFile = path.join(this.packagesDir, "index.json");
        if (fs.existsSync(indexFile)) {
            try {
                return JSON.parse(fs.readFileSync(indexFile, "utf-8"));
            } catch (err) {
                logger.debug(
                    "[PaperCrane] package index.json is corrupt, treating as empty:",
                    err,
                );
            }
        }
        return {};
    }

    public getPackagePath(packageName: string): string {
        const base = path.join(this.packagesDir, packageName);
        const found = this.findBinDir(base, 4);
        return found || base;
    }

    // Recursively searches for a directory containing a bin/ subdirectory, up to maxDepth levels
    private findBinDir(dir: string, maxDepth: number): string | null {
        return findBinDir(dir, maxDepth);
    }

    public async downloadPackage(
        packageName: string,
        _downloadId: string,
        onProgress?: ProgressCallback,
    ): Promise<string> {
        const cleanName = sanitizeId(packageName);
        if (!cleanName) {
            throw new Error(`Invalid package name: ${packageName}`);
        }
        packageName = cleanName;
        const log = (msg: string) =>
            logger.info(`[package:${packageName}] ${msg}`);

        const pkgDir = path.join(this.packagesDir, packageName);
        if (fs.existsSync(pkgDir)) {
            onProgress?.({
                stage: "completed",
                percent: 100,
                message: "Already installed",
            });
            return pkgDir;
        }

        const metaUrl = `${REGISTRY_URL}/package/${encodeURIComponent(packageName)}.json`;
        log(`resolving ${metaUrl}`);
        onProgress?.({
            stage: "checking",
            percent: 0,
            message: `Resolving package ${packageName}...`,
        });

        const metaRes = await fetch(metaUrl);
        if (!metaRes.ok) {
            throw new Error(
                `Package ${packageName} not found in repository (HTTP ${metaRes.status})`,
            );
        }
        const meta = (await metaRes.json()) as any;

        const currentOs =
            process.platform === "win32"
                ? "windows"
                : process.platform === "darwin"
                  ? "macos"
                  : "linux";
        const currentArch = process.arch === "arm64" ? "arm64" : "x64";
        const downloadInfo =
            meta.platforms?.[`${currentOs}-${currentArch}`] ||
            meta.downloads?.[`${currentOs}-${currentArch}`] ||
            meta.downloads?.[currentOs] ||
            meta.download;
        if (!downloadInfo?.url) {
            throw new Error(
                `No download available for ${packageName} on ${currentOs}-${currentArch}`,
            );
        }
        log(`source: ${downloadInfo.url}`);

        const tempArchive = path.join(
            this.packagesDir,
            `${packageName}-archive.tmp-${Date.now()}`,
        );
        try {
            log("downloading...");
            let lastMilestone = 0;
            const milestoneProgress: ProgressCallback = (payload) => {
                // Log every 10% milestone with real byte counts so the log
                // file shows the true download curve.
                if (
                    payload.stage === "downloading" &&
                    payload.bytesTotal &&
                    payload.percent - lastMilestone >= 10
                ) {
                    lastMilestone = Math.floor(payload.percent / 10) * 10;
                    log(
                        `${lastMilestone}% (${Math.round(payload.bytesLoaded! / 1048576)} MB)` +
                            (payload.bytesTotal
                                ? ` of ${Math.round(payload.bytesTotal! / 1048576)} MB`
                                : ""),
                    );
                }
                onProgress?.(payload);
            };
            await streamToFileWithProgress(
                downloadInfo.url,
                tempArchive,
                milestoneProgress,
                downloadInfo.sha1,
                downloadInfo.sha256,
            );
            const archiveSize = fs.existsSync(tempArchive)
                ? fs.statSync(tempArchive).size
                : -1;
            log(`download finished (${archiveSize} bytes)`);

            onProgress?.({
                stage: "extracting",
                percent: 50,
                message: "Extracting package...",
            });

            if (!fs.existsSync(pkgDir)) fs.mkdirSync(pkgDir, { recursive: true });

            // Runtime archives (Adoptium, Node, …) wrap everything in a single
            // top-level folder; strip it so <pkgDir>/bin/java holds. Archives
            // without a wrapper fall back to strip: 0.
            try {
                await tar.extract({
                    file: tempArchive,
                    cwd: pkgDir,
                    strip: 1,
                    filter: makeSafeTarFilter(path.resolve(pkgDir)),
                });
                if (!fs.existsSync(path.join(pkgDir, "bin"))) {
                    // No bin at top level — archive had no wrapper; re-extract flat
                    await fs.promises.rm(pkgDir, { recursive: true, force: true });
                    fs.mkdirSync(pkgDir, { recursive: true });
                    await tar.extract({
                        file: tempArchive,
                        cwd: pkgDir,
                        strip: 0,
                        filter: makeSafeTarFilter(path.resolve(pkgDir)),
                    });
                }
            } catch (err) {
                logger.debug(
                    `[package:${packageName}] initial tar extraction failed; retrying flat:`,
                    err,
                );
                await fs.promises.rm(pkgDir, { recursive: true, force: true });
                fs.mkdirSync(pkgDir, { recursive: true });
                await tar.extract({
                    file: tempArchive,
                    cwd: pkgDir,
                    strip: 0,
                    filter: makeSafeTarFilter(path.resolve(pkgDir)),
                });
            }
            log(`extraction complete; bin present: ${fs.existsSync(path.join(pkgDir, "bin"))}`);

            const index = this.getPackageIndex();
            index[packageName] = {
                name: packageName,
                version: meta.version || "latest",
                installedAt: new Date().toISOString(),
            };
            writeJsonAtomicSync(path.join(this.packagesDir, "index.json"), index);

            onProgress?.({
                stage: "completed",
                percent: 100,
                message: "Installed successfully",
            });
            return pkgDir;
        } catch (err: any) {
            log(`FAILED: ${err?.message || err}`);
            throw err;
        } finally {
            if (fs.existsSync(tempArchive)) {
                await fs.promises.unlink(tempArchive).catch(() => {});
            }
        }
    }

    // Extracts .tar.gz, .tgz, .zip or single files
    public async extractArchive(
        archivePath: string,
        destDir: string,
    ): Promise<void> {
        return extractArchive(archivePath, destDir);
    }

    // Panel installation and store operations
    public async listPanels(): Promise<PanelManifest[]> {
        if (!fs.existsSync(this.panelsDir)) return [];
        const entries = await fs.promises.readdir(this.panelsDir);
        const panels: PanelManifest[] = [];

        for (const entry of entries) {
            const panelPath = path.join(this.panelsDir, entry);
            let manifestPath = path.join(panelPath, "manifest.json");

            if (!fs.existsSync(manifestPath)) {
                try {
                    const subEntries = await fs.promises.readdir(panelPath);
                    for (const sub of subEntries) {
                        const subCandidate = path.join(
                            panelPath,
                            sub,
                            "manifest.json",
                        );
                        if (fs.existsSync(subCandidate)) {
                            manifestPath = subCandidate;
                            break;
                        }
                    }
                } catch {}
            }

            if (fs.existsSync(manifestPath)) {
                try {
                    const raw = JSON.parse(
                        await fs.promises.readFile(manifestPath, "utf-8"),
                    );
                    const validated = validatePanelManifest(raw, entry);
                    panels.push({
                        ...validated,
                        base: validated.base || "./dist/index.html",
                        isInstalled: true,
                    } as PanelManifest);
                } catch (err) {
                    logger.debug(
                        `[PaperCrane] panel manifest for ${entry} failed validation/read:`,
                        err,
                    );
                }
            }
        }
        return panels;
    }

    public async installPanel(
        panelId: string,
        downloadUrl: string,
        expectedSha256?: string,
    ): Promise<PanelManifest> {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) {
            throw new Error(`Invalid panel id: ${panelId}`);
        }
        const targetDir = path.join(this.panelsDir, cleanId);
        const stagingDir = `${targetDir}.staging-${Date.now()}`;
        const tempArchive = path.join(
            this.panelsDir,
            `${cleanId}.tmp-${Date.now()}.tar.gz`,
        );

        try {
            await streamToFileWithProgress(
                downloadUrl,
                tempArchive,
                undefined,
                undefined,
                expectedSha256,
            );

            if (fs.existsSync(stagingDir)) {
                await fs.promises.rm(stagingDir, {
                    recursive: true,
                    force: true,
                });
            }
            fs.mkdirSync(stagingDir, { recursive: true });
            await this.extractArchive(tempArchive, stagingDir);

            // If the archive wrapped everything in a single top-level folder,
            // collapse it so the panel content sits at the root.
            let contentDir = stagingDir;
            const stagingEntries = fs.readdirSync(stagingDir);
            if (
                stagingEntries.length === 1 &&
                fs.statSync(path.join(stagingDir, stagingEntries[0])).isDirectory()
            ) {
                contentDir = path.join(stagingDir, stagingEntries[0]);
            }

            let manifestFile = path.join(contentDir, "manifest.json");
            if (!fs.existsSync(manifestFile)) {
                const subEntries = fs.readdirSync(contentDir);
                for (const sub of subEntries) {
                    const subCandidate = path.join(contentDir, sub, "manifest.json");
                    if (fs.existsSync(subCandidate)) {
                        manifestFile = subCandidate;
                        break;
                    }
                }
            }

            const rawManifest = fs.existsSync(manifestFile)
                ? JSON.parse(await fs.promises.readFile(manifestFile, "utf-8"))
                : null;
            const manifest = rawManifest
                ? validatePanelManifest(rawManifest, cleanId)
                : { id: cleanId, name: cleanId, version: "1.0.0" };

            // Atomic swap: remove old install, move staged content into place
            if (fs.existsSync(targetDir)) {
                await fs.promises.rm(targetDir, {
                    recursive: true,
                    force: true,
                });
            }
            await moveFileSafe(contentDir, targetDir);
            await fs.promises
                .rm(stagingDir, { recursive: true, force: true })
                .catch(() => {});

            return {
                ...(manifest as PanelManifest),
                id: manifest.id || cleanId,
                publisher:
                    (manifest as any).publisher ||
                    (manifest as any).author ||
                    "Paperboard",
                isInstalled: true,
            };
        } catch (err) {
            await fs.promises
                .rm(stagingDir, { recursive: true, force: true })
                .catch(() => {});
            throw err;
        } finally {
            if (fs.existsSync(tempArchive))
                await fs.promises.unlink(tempArchive).catch(() => {});
        }
    }

    public async uninstallPanel(panelId: string): Promise<boolean> {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return false;

        // Stop any active terminals or processes for this panel
        for (const [id, client] of this.clients.entries()) {
            if (id.startsWith(cleanId) || id.includes(cleanId)) {
                client.kill("SIGTERM");
                client.destroy();
                this.clients.delete(id);
            }
        }

        const panelDir = path.join(this.panelsDir, cleanId);
        if (fs.existsSync(panelDir)) {
            await fs.promises.rm(panelDir, { recursive: true, force: true });
        }
        await this.clearFiles(cleanId);

        const configFile = path.join(this.configsDir, `${cleanId}.json`);
        if (fs.existsSync(configFile)) {
            await fs.promises.unlink(configFile).catch(() => {});
        }

        return true;
    }

    // Panel config persistence
    public async getConfig(id: string): Promise<any> {
        const file = path.join(this.configsDir, `${sanitizeId(id) || id}.json`);
        if (fs.existsSync(file)) {
            try {
                return JSON.parse(await fs.promises.readFile(file, "utf-8"));
            } catch (err) {
                logger.debug(
                    `[PaperCrane] config file for ${id} is corrupt, returning null:`,
                    err,
                );
            }
        }
        return null;
    }

    public async setConfig(id: string, data: any): Promise<boolean> {
        const file = path.join(this.configsDir, `${sanitizeId(id) || id}.json`);
        await writeFileAtomic(file, JSON.stringify(data, null, 2));
        return true;
    }
}
