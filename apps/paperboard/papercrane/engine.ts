// Core execution engine (terminals, processes, files, packages, panels, configs)
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
    panelFilesDirName,
    unrefTimer,
    validatePanelManifest,
    writeJsonAtomicSync,
    writeFileAtomic,
    LimitError,
} from "./storage";
import { getSocketsDir, getPaperboardDir } from "./paths";
import { logger } from "./logger";
import { spawnSupervisedClient } from "./engineSupervisor";
import { getDefaultShell } from "./pty";
import { extractArchive, findBinDir } from "./engineArchives";
import { panelServices } from "./panelServices";
import { CredentialStore } from "./credentials";
import { resolveRegistryUrl } from "./util";

export const REGISTRY_URL = resolveRegistryUrl();

// install provenance: whether a panel arrived through the reviewed registry
// or a direct checksummed URL is a daemon-owned fact, recorded at install
// time and surfaced in the library ("Reviewed by Paperboard" vs "Direct
// install"). The registry is closed and reviewed; a direct URL install is
// checksum-verified but NOT reviewed — the two words must never blur.
export function resolveInstallSource(downloadUrl: string): "registry" | "direct" {
    try {
        return new URL(downloadUrl).origin === new URL(REGISTRY_URL).origin
            ? "registry"
            : "direct";
    } catch (err) {
        logger.debug("[engine] install source resolve failed, treating as direct:", err);
        return "direct";
    }
}

// bounded payloads: file reads refuse past 16 MiB (larger blobs stream via
// file:download), config payloads past 1 MiB serialized
export const FILE_READ_MAX_BYTES = 16 * 1024 * 1024;
export const CONFIG_MAX_BYTES = 1 * 1024 * 1024;

export class PaperCraneEngine {
    private appDataDir: string;
    private packagesDir: string;
    private filesDir: string;
    private panelsDir: string;
    private configsDir: string;
    private localDir: string;
    private credentialsStore: CredentialStore;
    private clients = new Map<string, SupervisedProcessClient>();

    constructor(baseDir?: string) {
        this.appDataDir = baseDir || getPaperboardDir();
        this.packagesDir = path.join(this.appDataDir, "packages");
        this.filesDir = path.join(this.appDataDir, "files");
        this.panelsDir = path.join(this.appDataDir, "panels");
        this.configsDir = path.join(this.appDataDir, "configs");
        this.localDir = path.join(this.appDataDir, "local");

        for (const dir of [
            this.appDataDir,
            this.packagesDir,
            this.filesDir,
            this.panelsDir,
            this.configsDir,
            this.localDir,
        ]) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }

        this.credentialsStore = new CredentialStore(this.appDataDir);
    }

    // install provenance record: one small daemon-owned JSON beside the
    // panels dir — OUTSIDE any panel directory, because upgrades swap that
    // directory wholesale and the fact must survive them. One entry per
    // panel id; removed when the panel is uninstalled.
    private installSourcesPath(): string {
        return path.join(this.panelsDir, ".install-sources.json");
    }

    private readInstallSources(): Record<string, { source: string; at: string }> {
        try {
            const raw = JSON.parse(fs.readFileSync(this.installSourcesPath(), "utf-8"));
            return raw && typeof raw === "object" ? raw : {};
        } catch (err: any) {
            if (err?.code !== "ENOENT") {
                logger.debug("[engine] install sources read failed:", err?.message || err);
            }
            return {};
        }
    }

    private writeInstallSources(map: Record<string, { source: string; at: string }>): void {
        try {
            fs.writeFileSync(this.installSourcesPath(), JSON.stringify(map, null, 2));
        } catch (err: any) {
            logger.error(`[engine] install sources write failed: ${err?.message || err}`);
        }
    }

    private recordInstallSource(cleanId: string, source: "registry" | "direct"): void {
        const map = this.readInstallSources();
        map[cleanId] = { source, at: new Date().toISOString() };
        this.writeInstallSources(map);
    }

    private forgetInstallSource(cleanId: string): void {
        const map = this.readInstallSources();
        if (!(cleanId in map)) return;
        delete map[cleanId];
        this.writeInstallSources(map);
    }

    // Removes interrupted download/install artifacts (*.tmp-*, *.staging-*).
    // These appear when a crash/restart interrupts a long operation.
    //
    // Explicit, NOT in the constructor: sweeping deletes live temp files,
    // so it must only run after this instance owns its port. A second
    // daemon constructed during a port race (see index.ts tryStart) must
    // never sweep the first daemon's in-flight downloads.
    public sweepStartupOrphans(): void {
        this.sweepOrphans();
    }

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
            } catch (err) { logger.debug("[engine.ts] op failed:", err) }
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
        const dir = path.join(this.filesDir, panelFilesDirName(appId));
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    // Resolves path inside panel isolated storage preventing path traversal
    public resolveSecureTargetPath(targetPath: string, appId?: string): string {
        return resolveSecureTargetPath(this.filesDir, targetPath, appId);
    }

    // Shared spawn cwd: explicit cwd wins, else home, else process cwd.
    private resolveSpawnCwd(cwd?: string): string {
        if (cwd) {
            const resolved = path.resolve(cwd);
            // explicit but missing cwd must fail, never fall back silently
            if (!fs.existsSync(resolved)) {
                throw new Error(`spawn cwd does not exist: ${resolved}`);
            }
            return resolved;
        }
        return typeof os.homedir === "function" ? os.homedir() : process.cwd();
    }

    // re-attach replaces listeners instead of stacking duplicates
    private attachedStreamCallbacks = new WeakMap<
        object,
        Record<string, ((...args: any[]) => void) | undefined>
    >();

    private replaceStreamListeners(
        client: SupervisedProcessClient,
        listeners: Record<string, ((...args: any[]) => void) | undefined>,
    ): void {
        const prev = this.attachedStreamCallbacks.get(client);
        if (prev) {
            for (const [event, fn] of Object.entries(prev)) {
                if (fn) client.off(event, fn);
            }
        }
        this.attachedStreamCallbacks.set(client, listeners);
        for (const [event, fn] of Object.entries(listeners)) {
            if (fn) client.on(event, fn);
        }
    }

    // ownership ledger: supervised id → creating panel claim (null =
    // master/host-created or pre-ledger). One entry per live client id,
    // deleted with the client — bounded by the client map itself. The RPC
    // layer records the socket claim on create and warns on mismatches
    // (rpc/ownership.ts); enforcement waits for the registry-opening gate.
    private clientOwners = new Map<string, string | null>();

    public setClientOwner(id: string, owner: string | null): void {
        if (typeof id === "string" && id) this.clientOwners.set(id, owner ?? null);
    }

    public clientOwner(id: string): string | null {
        return this.clientOwners.get(id) ?? null;
    }

    // lookup with reconnect, shared by attach/isRunning
    private async getOrConnectClient(
        id: string,
    ): Promise<SupervisedProcessClient | null> {
        let client = this.clients.get(id);
        if (!client) {
            if (!fs.existsSync(getSupervisorSocketPath(id))) return null;
            client = new SupervisedProcessClient(id);
            if (!(await client.connect())) return null;
            this.clients.set(id, client);
        }
        return client;
    }

    // Manifest hunt: root manifest.json, else one level of subdirectories
    private findManifestFile(dir: string): string | null {
        const root = path.join(dir, "manifest.json");
        if (fs.existsSync(root)) return root;
        try {
            for (const sub of fs.readdirSync(dir)) {
                const candidate = path.join(dir, sub, "manifest.json");
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch (err) { logger.debug("[engine.ts] op failed:", err) }
        return null;
    }

    private sanitizeIdOrThrow(id: string, what: string): string {
        const clean = sanitizeId(id);
        if (!clean) throw new Error(`Invalid ${what} id: ${id}`);
        return clean;
    }

    public getAppDataDir(): string {
        return this.appDataDir;
    }

    // Config filenames are built from validated ids only. There is no
    // fallback to raw input: a traversal id must throw here, never shape
    // a path (the RPC boundary refuses it first with INVALID_PARAMS;
    // this throw is the defense for direct engine callers).
    private configFileName(id: string): string {
        return `${this.sanitizeIdOrThrow(id, "config")}.json`;
    }

    // globals in local/, panel working data in files/<id>/data.json
    private isAppGlobalConfig(id: string): boolean {
        return id === "app-settings" || id.startsWith("shell-");
    }

    private configFileFor(id: string): string {
        if (this.isAppGlobalConfig(id)) {
            return path.join(this.localDir, this.configFileName(id));
        }
        if (id === "crane_version") {
            return path.join(this.configsDir, this.configFileName(id));
        }
        return path.join(this.filesDir, panelFilesDirName(id), "data.json");
    }

    private legacyConfigPaths(id: string): string[] {
        // TODO(remove after v3.1): pre-move read-through locators die with
        // the first stable release after Alpha 2 installs are on this scheme
        // The id is validated up front, so every path below is built from a
        // known-safe token plus fixed legacy basenames: caller input selects
        // which known names to probe, it never shapes a path.
        const clean = this.sanitizeIdOrThrow(id, "config");
        const current = this.configFileFor(clean);
        const name = this.configFileName(clean);
        const dir = panelFilesDirName(clean);
        const paths: string[] = [];
        // Pre-move locations, newest scheme first — read through once.
        // tabs.json / workspace.json are retired per-panel names from before
        // the filename was unified; they migrate to data.json on next write.
        const candidates = [
            path.join(this.filesDir, dir, "tabs.json"),
            path.join(this.filesDir, dir, "workspace.json"),
            path.join(this.filesDir, dir, "config.json"),
            path.join(this.filesDir, name),
            path.join(this.configsDir, name),
            path.join(this.localDir, name),
        ];
        for (const p of candidates) {
            if (p !== current && !paths.includes(p)) paths.push(p);
        }
        return paths;
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
        // platform-aware shell, don't trust $SHELL in GUI apps
        const shell =
            process.platform === "win32" ? "powershell.exe" : getDefaultShell();
        const resolvedCwd = this.resolveSpawnCwd(cwd);
        logger.debug(`[PaperCrane] creating terminal ${id} (shell=${shell} cwd=${resolvedCwd})`);

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
        this.clientOwners.delete(id);
    }

    // Reattaches streaming for a terminal owned by a previous session
    public async attachTerminal(
        id: string,
        onData?: (data: string) => void,
        onExit?: (code: number) => void,
    ): Promise<boolean> {
        const client = await this.getOrConnectClient(id);
        if (!client) return false;
        this.replaceStreamListeners(client, { data: onData, exit: onExit });
        return true;
    }

    public async isTerminalRunning(id: string): Promise<boolean> {
        const client = await this.getOrConnectClient(id);
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
        if (!id || typeof id !== "string") {
            throw new Error("process id is required");
        }
        const resolvedCwd = this.resolveSpawnCwd(cwd);

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
                        this.clientOwners.delete(id);
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
        if (!client) {
            this.clientOwners.delete(id);
            return;
        }
        this.clients.delete(id);
        this.clientOwners.delete(id);

        client.kill(signal);

        // destroy() clears listeners, drop it after exit fires. the timer
        // is unref'd so a killed process never holds the daemon open
        const teardown = () => client.destroy();
        client.on("exit", teardown);
        unrefTimer(setTimeout(teardown, 5000));
    }

    public async isProcessRunning(id: string): Promise<boolean> {
        const client = await this.getOrConnectClient(id);
        return client?.isConnected() ?? false;
    }

    public async attachProcess(
        id: string,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<boolean> {
        const client = await this.getOrConnectClient(id);
        if (!client) return false;
        this.replaceStreamListeners(client, {
            data: onData,
            stdout: onStdout,
            stderr: onStderr,
            exit: onExit,
        });
        return true;
    }

    // Panel file management
    public getFilePath(targetPath: string, appId?: string): string {
        return this.resolveSecureTargetPath(targetPath, appId);
    }

    // Deletes a file inside isolated storage, files only
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
        // bounded read: stat first so a runaway data file refuses instead
        // of slurping gigabytes into one WS frame (self-DoS otherwise)
        const stat = await fs.promises.stat(fullPath);
        if (stat.size > FILE_READ_MAX_BYTES) {
            throw new LimitError(
                `File exceeds ${FILE_READ_MAX_BYTES} byte read cap: ${targetPath}`,
            );
        }
        return await fs.promises.readFile(fullPath, "utf-8");
    }

    public async clearFiles(appId?: string): Promise<boolean> {
        const base = this.resolveAppFilesDir(appId);
        if (fs.existsSync(base)) {
            await fs.promises.rm(base, { recursive: true, force: true });
        }
        return true;
    }

    // Recovers running supervisor clients from previous sessions
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

    // shutdown all clients: SIGTERM, then SIGKILL after grace
    public async disposeClients(graceMs = 5000): Promise<void> {
        const entries = [...this.clients.entries()];
        if (entries.length === 0) return;

        for (const [, client] of entries) {
            try {
                client.kill("SIGTERM");
            } catch (err) { logger.debug("[engine.ts] op failed:", err) }
        }

        const deadline = Date.now() + graceMs;
        while (Date.now() < deadline) {
            if (entries.every(([, client]) => !client.isConnected())) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        this.killAllClients();
    }

    // last-resort sync teardown for exit handlers
    public killAllClients(): void {
        for (const [id, client] of [...this.clients.entries()]) {
            try {
                if (client.isConnected()) client.kill("SIGKILL");
            } catch (err) { logger.debug("[engine.ts] op failed:", err) }
            try {
                client.destroy();
            } catch (err) { logger.debug("[engine.ts] op failed:", err) }
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
                await fs.promises.unlink(tempPath).catch((err) => logger.debug("[engine] temp unlink failed:", err));
            onProgress?.({ stage: "error", percent: 0, message: err.message });
            throw err;
        }
    }

    // Runtime package management
    public isPackageInstalled(packageName: string, version?: string): boolean {
        const base = path.join(this.packagesDir, packageName);
        if (!fs.existsSync(base)) return false;
        if (this.findBinDir(base, 4) === null) return false;
        // a requested version is a promise: confirm it against the install
        // index instead of ignoring it. "latest"/omitted keeps the old
        // presence check; installs predating the index re-verify once by
        // reinstalling, then read as installed.
        if (version && version !== "latest") {
            const entry = this.getPackageIndex()?.[packageName];
            const installed = typeof entry?.version === "string" ? entry.version : null;
            if (!installed) return false;
            return installed === version;
        }
        return true;
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

    // Recursively searches for a bin/ dir, up to maxDepth levels
    private findBinDir(dir: string, maxDepth: number): string | null {
        return findBinDir(dir, maxDepth);
    }

    public async downloadPackage(
        packageName: string,
        _downloadId: string,
        onProgress?: ProgressCallback,
        expectedSha256?: string,
    ): Promise<string> {
        // trust boundary: same rule as installPanel — no checksum fact from
        // the anchor means no install, never proceed with sha256: undefined
        if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
            throw new Error(
                `Install refused for package "${packageName}": registry did not provide a sha256 checksum`,
            );
        }
        packageName = this.sanitizeIdOrThrow(packageName, "package");
        const log = (msg: string) =>
            logger.info(`[package:${packageName}] ${msg}`);

        const pkgDir = path.join(this.packagesDir, packageName);
        // leftover dir without bin/ is a failed install, wipe and retry
        if (fs.existsSync(pkgDir)) {
            if (this.findBinDir(pkgDir, 4)) {
                onProgress?.({
                    stage: "completed",
                    percent: 100,
                    message: "Already installed",
                });
                return pkgDir;
            }
            log("found incomplete previous install, removing and reinstalling...");
            await fs.promises.rm(pkgDir, { recursive: true, force: true });
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
        // the updater's checksum fact must agree with the metadata record;
        // a mismatch means one of the two sources is lying — refuse
        if (typeof downloadInfo.sha256 === "string" && downloadInfo.sha256.length > 0) {
            if (downloadInfo.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
                throw new Error(
                    `Install refused for package "${packageName}": checksum mismatch between update plan and registry metadata`,
                );
            }
        }

        // keep the URL extension so extraction dispatches on format
        let urlExt = "";
        try {
            const urlBase = path.basename(new URL(downloadInfo.url).pathname).toLowerCase();
            if (urlBase.endsWith(".zip")) urlExt = ".zip";
            else if (urlBase.endsWith(".tgz")) urlExt = ".tgz";
            else if (urlBase.endsWith(".tar.gz")) urlExt = ".tar.gz";
            else if (urlBase.endsWith(".tar")) urlExt = ".tar";
        } catch (err) { logger.debug("[engine.ts] op failed:", err) }
        const tempArchive = path.join(
            this.packagesDir,
            `${packageName}-archive.tmp-${Date.now()}${urlExt}`,
        );
        try {
            log("downloading...");
            let lastMilestone = 0;
            const milestoneProgress: ProgressCallback = (payload) => {
                // log every 10% with byte counts
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
                expectedSha256,
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

            // zips via bundled unzipper, tarballs keep strip handling
            if (urlExt === ".zip") {
                await extractArchive(tempArchive, pkgDir);
            } else {
                // strip a single top-level wrapper dir, fallback to flat
                try {
                    await tar.extract({
                        file: tempArchive,
                        cwd: pkgDir,
                        strip: 1,
                        filter: makeSafeTarFilter(path.resolve(pkgDir)),
                    });
                    if (!fs.existsSync(path.join(pkgDir, "bin"))) {
                        // no wrapper at top level, re-extract flat
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
            }
            log(
                `extraction complete; bin present: ${this.findBinDir(pkgDir, 4) !== null}`,
            );

            // require bin/ before indexing, else remove and fail
            if (!this.findBinDir(pkgDir, 4)) {
                await fs.promises.rm(pkgDir, { recursive: true, force: true });
                throw new Error(
                    `Package ${packageName} extracted but no usable binary directory was found — removed partial install`,
                );
            }

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
            if (fs.existsSync(pkgDir) && !this.findBinDir(pkgDir, 4)) {
                await fs.promises.rm(pkgDir, { recursive: true, force: true }).catch((err) => logger.debug("[engine] package dir cleanup failed:", err));
                log("removed partial install");
            }
            throw err;
        } finally {
            if (fs.existsSync(tempArchive)) {
                await fs.promises.unlink(tempArchive).catch((err) => logger.debug("[engine] archive cleanup failed:", err));
            }
        }
    }

    public async extractArchive(
        archivePath: string,
        destDir: string,
    ): Promise<void> {
        return extractArchive(archivePath, destDir);
    }

    public async listPanels(): Promise<PanelManifest[]> {
        if (!fs.existsSync(this.panelsDir)) return [];
        const entries = await fs.promises.readdir(this.panelsDir);
        const panels: PanelManifest[] = [];
        const sources = this.readInstallSources();

        for (const entry of entries) {
            const panelPath = path.join(this.panelsDir, entry);
            const manifestPath = this.findManifestFile(panelPath);

            if (manifestPath) {
                try {
                    const raw = JSON.parse(
                        await fs.promises.readFile(manifestPath, "utf-8"),
                    );
                    const validated = validatePanelManifest(raw, entry);
                    let isDevLink = false;
                    try {
                        isDevLink = fs.lstatSync(panelPath).isSymbolicLink();
                    } catch (err) { logger.debug("[engine.ts] op failed:", err) }
                    panels.push({
                        ...validated,
                        base: validated.base || "./dist/index.html",
                        isInstalled: true,
                        isDevLink,
                        isLinked: isDevLink,
                        installSource: isDevLink
                            ? "dev"
                            : (sources[entry]?.source as
                                  | "registry"
                                  | "direct"
                                  | undefined),
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
        // trust boundary: no checksum fact from the anchor means no install,
        // no matter where the URL came from
        if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
            throw new Error(
                `Install refused for "${panelId}": registry did not provide a sha256 checksum`,
            );
        }
        const cleanId = this.sanitizeIdOrThrow(panelId, "panel");
        const targetDir = path.join(this.panelsDir, cleanId);

        if (fs.existsSync(targetDir)) {
            try {
                if (fs.lstatSync(targetDir).isSymbolicLink()) {
                    throw new Error(
                        `Panel "${cleanId}" is currently symlinked for development. Remove the dev link before installing from registry.`,
                    );
                }
            } catch (err: any) {
                if (err?.message?.includes("symlinked for development")) throw err;
            }
        }
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

            // collapse a single top-level wrapper folder to the root
            let contentDir = stagingDir;
            const stagingEntries = fs.readdirSync(stagingDir);
            if (
                stagingEntries.length === 1 &&
                fs.statSync(path.join(stagingDir, stagingEntries[0])).isDirectory()
            ) {
                contentDir = path.join(stagingDir, stagingEntries[0]);
            }

            const manifestFile = this.findManifestFile(contentDir);

            const rawManifest = manifestFile && fs.existsSync(manifestFile)
                ? JSON.parse(await fs.promises.readFile(manifestFile, "utf-8"))
                : null;
            const manifest = rawManifest
                ? validatePanelManifest(rawManifest, cleanId)
                : { id: cleanId, name: cleanId };

            // atomic swap into place: the live dir moves to trash first,
            // so a failed swap leaves the previous version recoverable
            // instead of deleting the working panel before its replacement
            // exists. Same rename-to-trash discipline as uninstall.
            const trashDir = path.join(this.panelsDir, `.trash-${Date.now()}-${cleanId}`);
            if (fs.existsSync(targetDir)) {
                await fs.promises.rename(targetDir, trashDir);
            }
            try {
                await moveFileSafe(contentDir, targetDir);
                if (fs.existsSync(trashDir)) {
                    await fs.promises
                        .rm(trashDir, { recursive: true, force: true })
                        .catch((err) => logger.debug("[engine] upgrade trash cleanup failed:", err));
                }
            } catch (err) {
                // swap failed: restore the previous version from trash
                if (fs.existsSync(trashDir) && !fs.existsSync(targetDir)) {
                    await fs.promises
                        .rename(trashDir, targetDir)
                        .catch((restoreErr) =>
                            logger.error(
                                `[engine] panel "${cleanId}" upgrade failed AND restore from trash failed; previous version survives at ${trashDir}:`,
                                restoreErr,
                            ),
                        );
                }
                throw err;
            }
            await fs.promises
                .rm(stagingDir, { recursive: true, force: true })
                .catch((err) => logger.debug("[engine] staging cleanup failed:", err));

            // provenance is recorded only after the panel is actually in
            // place: a failed install must not leave a Reviewed/Direct fact
            // behind for something that does not exist
            this.recordInstallSource(cleanId, resolveInstallSource(downloadUrl));

            try {
                panelServices.startService(cleanId);
            } catch (err: any) {
                logger.warn(`[PaperCrane] Failed to start service for newly installed panel ${cleanId}:`, err?.message || err);
            }

            return {
                ...(manifest as PanelManifest),
                id: manifest.id || cleanId,
                publisher:
                    (manifest as any).publisher ||
                    (manifest as any).author,
                isInstalled: true,
            };
        } catch (err) {
            await fs.promises
                .rm(stagingDir, { recursive: true, force: true })
                .catch((cleanupErr) => logger.debug("[engine] staging cleanup failed:", cleanupErr));
            throw err;
        } finally {
            if (fs.existsSync(tempArchive))
                await fs.promises.unlink(tempArchive).catch((err) => logger.debug("[engine] archive cleanup failed:", err));
        }
    }

    // removes stale .trash-<ts>-<id> dirs left by a crashed uninstall.
    // Scoped to this panel id only — never a directory walk that could
    // touch a live panel.
    private async sweepPanelTrash(cleanId: string): Promise<void> {
        let entries: string[];
        try {
            entries = await fs.promises.readdir(this.panelsDir);
        } catch (err) {
            logger.debug("[engine] trash sweep readdir failed:", err);
            return;
        }
        const suffix = `-${cleanId}`;
        for (const entry of entries) {
            if (entry.startsWith(".trash-") && entry.endsWith(suffix)) {
                await fs.promises
                    .rm(path.join(this.panelsDir, entry), { recursive: true, force: true })
                    .catch((err) => logger.debug("[engine] trash sweep rm failed:", err));
            }
        }
    }

    public async uninstallPanel(panelId: string): Promise<boolean> {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return false;

        try {
            panelServices.stopService(cleanId);
        } catch (err) { logger.debug("[engine.ts] op failed:", err) }

        // exact id or owned prefix only (`panel:child`); substring matching
        // let uninstalling "game" terminate "game2"/"retrogame" clients
        for (const [id, client] of this.clients.entries()) {
            if (id === cleanId || id.startsWith(`${cleanId}:`)) {
                client.kill("SIGTERM");
                client.destroy();
                this.clients.delete(id);
                this.clientOwners.delete(id);
            }
        }

        const panelDir = path.join(this.panelsDir, cleanId);
        if (fs.existsSync(panelDir)) {
            // destructive boundary, recoverable: rename to trash first so
            // a crash mid-delete leaves a clearly-marked .trash-<ts>-<id>
            // dir instead of a half-deleted live panel. Stale trash from a
            // previous crash is swept at the next uninstall of the same id.
            await this.sweepPanelTrash(cleanId);
            const trashDir = path.join(this.panelsDir, `.trash-${Date.now()}-${cleanId}`);
            await fs.promises.rename(panelDir, trashDir);
            await fs.promises.rm(trashDir, { recursive: true, force: true });
        }
        await this.clearFiles(cleanId);

        // Panel working data lives at files/<panel>/data.json (removed
        // with the files dir above); sweep current + legacy spots anyway.
        for (const configFile of [this.configFileFor(cleanId), ...this.legacyConfigPaths(cleanId)]) {
            if (fs.existsSync(configFile)) {
                await fs.promises.unlink(configFile).catch((err) => logger.debug("[engine] config unlink failed:", err));
            }
        }

        this.credentialsStore.purge(cleanId);
        // a removed panel stops authenticating immediately: its scoped
        // token is revoked, not left lingering in the vault
        panelServices.revokePanel(cleanId);
        // and its provenance fact goes with it — a record for a panel that
        // is not installed is a lie
        this.forgetInstallSource(cleanId);

        return true;
    }

    public async getConfig(id: string): Promise<any> {
        // service-owned boundary: traversal ids throw before touching disk
        this.sanitizeIdOrThrow(id, "config");
        const files = [
            this.configFileFor(id),
            ...this.legacyConfigPaths(id),
        ];
        for (const file of files) {
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
        }
        return null;
    }

    public async setConfig(id: string, data: any): Promise<boolean> {
        // service-owned boundary: traversal ids throw before touching disk
        this.sanitizeIdOrThrow(id, "config");
        // bounded payload: config is small structured state, never a blob
        // store — 1 MiB serialized refuses before the atomic write
        const serialized = JSON.stringify(data, null, 2);
        if (serialized.length > CONFIG_MAX_BYTES) {
            throw new LimitError(
                `Config "${id}" exceeds ${CONFIG_MAX_BYTES} byte payload cap`,
            );
        }
        const file = this.configFileFor(id);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, serialized);
        for (const legacy of this.legacyConfigPaths(id)) {
            await fs.promises.unlink(legacy).catch((err) => logger.debug("[engine] legacy config unlink failed:", err));
        }
        return true;
    }

    // Secret vault delegation — daemon-owned store, see credentials.ts
    public setSecret(name: string, value: string, panelId: string): void {
        this.credentialsStore.set(name, value, panelId);
    }

    public getSecret(name: string, panelId: string): { found: boolean; value: string | null } {
        return this.credentialsStore.get(name, panelId);
    }

    public deleteSecret(name: string, panelId: string): boolean {
        return this.credentialsStore.delete(name, panelId);
    }

    public listSecrets(panelId?: string, includeOtherPanels = false): string[] {
        return this.credentialsStore.list(panelId, includeOtherPanels);
    }

    public purgeSecrets(panelId: string): number {
        return this.credentialsStore.purge(panelId);
    }
}
