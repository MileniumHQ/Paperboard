// Core execution engine (terminals, processes, files, packages, panels, configs)
import path from "path";
import fs from "fs";
import os from "os";
import {
    SupervisedProcessClient,
    supervisorPresent,
    supervisorEndpointName,
    supervisorSocketPathForName,
} from "./supervisor";
import { PanelManifest } from "./types";
import {
    ProgressCallback,
    streamToFileWithProgress,
    moveFileSafe,
    resolveSecureTargetPath,
    openResolvedFile,
    sanitizeId,
    panelFilesDirName,
    validatePanelManifest,
    writeJsonAtomicSync,
    writeFileAtomic,
    LimitError,
} from "./storage";
import { getSocketsDir, getPaperboardDir } from "./paths";
import { logger } from "./logger";
import { spawnSupervisedClient } from "./engineSupervisor";
import { getDefaultShell } from "./pty";
import { extractArchive, extractPackageArchive, findBinDir, packageArchiveSuffix, parsePackageLayout } from "./engineArchives";
import { panelServices, PanelServicesManager } from "./panelServices";
import { CredentialStore } from "./credentials";
import { RpcError } from "./rpc/errors";
import { ErrorCode } from "./protocol";
import { resolveRegistryUrl } from "./util";
import { requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import { fetchRegistryRecord } from "./registryRecord";
import { RELEASE_PUBLIC_KEY, releaseMessage, requireReleaseSignature } from "./releaseSignature";

export const REGISTRY_URL = resolveRegistryUrl();

// what a caller expects to install (the release it showed the user or
// planned an update to); the daemon's own registry lookup must agree
export interface ExpectedPanelRelease {
    version?: string;
    sha256?: string;
}

// a verified runtime release kept beside the installed one until the
// workloads running from the installed one have stopped
export interface StagedPackage {
    name: string;
    version: string;
    sha256: string;
}

// a package update that is downloaded and verified but not yet installed:
// either it waits for the listed workloads (owner null: the host), or its
// swap failed and the previous release was rolled back in place
export interface PackageUpdateWait {
    name: string;
    version: string;
    blockedBy: Array<{ processId: string; owner: string | null }>;
    error?: string;
}

// a package install either completed, or it is staged and waits
export interface PackageInstallOutcome {
    path: string;
    waiting?: PackageUpdateWait;
}

const MAX_STAGED_PACKAGES = 64;

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
    private operations = new Set<string>();
    private services: PanelServicesManager;
    // the command each live workload runs, which says which runtime package
    // it holds. Missing or null means unknown, which blocks every swap.
    private clientCommands = new Map<string, string | null>();
    private stagedPackages = new Map<string, StagedPackage>();
    private swapFailures = new Map<string, { version: string; error: string }>();
    private swaps = new Map<string, Promise<void>>();
    // packages whose directory is being renamed right now
    private swapping = new Set<string>();
    // supervisors that outlived the previous daemon are users too: no swap
    // decides before they are adopted
    private recovery: Promise<void> = Promise.resolve();

    // registryUrl and releaseKey are fixed in production; tests point them
    // at a loopback registry signed with a fixture key
    constructor(
        baseDir?: string,
        services?: PanelServicesManager,
        private registryUrl = REGISTRY_URL,
        private releaseKey = RELEASE_PUBLIC_KEY,
    ) {
        this.services = services ?? (baseDir ? new PanelServicesManager(baseDir) : panelServices);
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
        // local/ holds this computer's credentials (vault, paired tokens, TLS
        // identity): owner-only, so other accounts cannot even list it. The
        // files inside are 0600 regardless; on filesystems without modes
        // (FAT on a USB stick) the chmod is refused and those modes remain.
        if (process.platform !== "win32") {
            try { fs.chmodSync(this.localDir, 0o700); }
            catch (err) { logger.warn(`[engine] could not restrict ${this.localDir} to its owner:`, err); }
        }

        this.credentialsStore = new CredentialStore(this.appDataDir);
        const ownersFile = path.join(this.localDir, "process-owners.json");
        if (fs.existsSync(ownersFile)) {
            const owners = JSON.parse(fs.readFileSync(ownersFile, "utf8"));
            this.clientOwners = new Map(Object.entries(owners) as [string, string | null][]);
        }
        this.loadStagedPackages();
    }

    // read-only: a second daemon constructed in a port race may load these
    // too, but only the instance that owns the port swaps or sweeps
    private loadStagedPackages(): void {
        let entries: string[];
        try {
            entries = fs.readdirSync(this.packagesDir);
        } catch (err) {
            logger.warn("[engine] could not list staged package updates:", err);
            return;
        }
        for (const entry of entries) {
            const match = /^\.staged-(.+)\.json$/.exec(entry);
            if (!match || this.stagedPackages.size >= MAX_STAGED_PACKAGES) continue;
            try {
                const record = JSON.parse(fs.readFileSync(path.join(this.packagesDir, entry), "utf8"));
                const name = match[1]!;
                if (
                    record?.name !== name || sanitizeId(name) !== name ||
                    typeof record.version !== "string" || !record.version ||
                    typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.sha256) ||
                    !this.findBinDir(this.stagedDir(name), 4)
                ) {
                    logger.warn(`[engine] staged package record ${entry} does not describe a staged release; ignoring it`);
                    continue;
                }
                this.stagedPackages.set(name, { name, version: record.version, sha256: record.sha256 });
            } catch (err) {
                logger.warn(`[engine] staged package record ${entry} is unreadable; ignoring it:`, err);
            }
        }
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
        this.sweepPackageSwaps();
    }

    // a swap interrupted between its two renames leaves the previous
    // release parked and no installed one: put it back. A parked copy beside
    // an installed release is a finished swap's leftover. A staged directory
    // without its record is a staging that never completed.
    private sweepPackageSwaps(): void {
        let entries: string[];
        try {
            entries = fs.readdirSync(this.packagesDir);
        } catch (err) {
            logger.warn("[engine] could not list packages to recover interrupted swaps:", err);
            return;
        }
        for (const entry of entries) {
            const full = path.join(this.packagesDir, entry);
            try {
                const parked = /^\.replaced-\d+-(.+)$/.exec(entry);
                if (parked) {
                    const target = path.join(this.packagesDir, parked[1]!);
                    if (fs.existsSync(target)) {
                        fs.rmSync(full, { recursive: true, force: true });
                    } else {
                        fs.renameSync(full, target);
                        logger.warn(`[engine] restored ${parked[1]} from an interrupted update`);
                    }
                    continue;
                }
                const staged = /^\.staged-(.+?)(\.json)?$/.exec(entry);
                if (staged && !this.stagedPackages.has(staged[1]!)) {
                    fs.rmSync(full, { recursive: true, force: true });
                }
            } catch (err) {
                logger.error(`[engine] could not recover ${entry} after an interrupted package update:`, err);
            }
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
        const dir = this.resolveSecureTargetPath("", appId);
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
    // layer records the socket claim on create and refuses mismatches
    // (rpc/ownership.ts).
    private clientOwners = new Map<string, string | null>();

    public setClientOwner(id: string, owner: string | null): void {
        if (typeof id === "string" && id) {
            if (!this.clientOwners.has(id) && this.clientOwners.size >= 10_000) throw new LimitError("Process ownership ledger is full");
            this.clientOwners.set(id, owner ?? null);
            writeJsonAtomicSync(path.join(this.localDir, "process-owners.json"), Object.fromEntries(this.clientOwners), { mode: 0o600 });
        }
    }

    // records the creator of a workload that now exists. A workload that
    // already exited (and was forgotten) gets no entry.
    public recordClientOwner(id: string, owner: string | null): void {
        if (!this.clients.has(id)) return;
        this.setClientOwner(id, owner);
    }

    // drops a finished workload's ledger entry, on disk too: an entry left
    // in process-owners.json would outlive the workload across a restart.
    // A failed write keeps the stale entry, which only over-claims (refuses
    // other panels that id) — it never grants anything — so it is logged
    // rather than thrown into the exit path that called this.
    private forgetClientOwner(id: string): void {
        if (!this.clientOwners.delete(id)) return;
        try {
            writeJsonAtomicSync(path.join(this.localDir, "process-owners.json"), Object.fromEntries(this.clientOwners), { mode: 0o600 });
        } catch (err) {
            logger.error(`[engine] could not persist the end of ${id}'s ownership; the stale entry over-claims until the next write:`, err);
        }
    }

    public clientOwner(id: string): string | null {
        return this.clientOwners.get(id) ?? null;
    }

    /** Each running panel service's process, by panel. */
    public serviceRoots(): Array<{ panelId: string; pid: number }> {
        return this.services.processRoots();
    }

    /** Each live workload's supervisor process and the panel that created it (null: the host). */
    public workloadRoots(): Array<{ owner: string | null; pid: number }> {
        const roots: Array<{ owner: string | null; pid: number }> = [];
        for (const [id, client] of this.clients) {
            if (client.pid > 0) roots.push({ owner: this.clientOwners.get(id) ?? null, pid: client.pid });
        }
        return roots;
    }

    // lookup with reconnect, shared by attach/isRunning
    private async getOrConnectClient(
        id: string,
    ): Promise<SupervisedProcessClient | null> {
        let client = this.clients.get(id);
        if (!client) {
            // Windows supervisors listen on a named pipe, which fs cannot
            // stat: supervisorPresent keys off the metadata file there so an
            // orphaned Ollama is found and stopped instead of a second
            // supervisor racing the same pipe name.
            if (!supervisorPresent(id)) return null;
            client = new SupervisedProcessClient(id);
            if (!(await client.connect())) return null;
            this.clients.set(id, client);
            this.clientCommands.set(id, this.supervisorCommand(id));
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

    // globals in local/, panel configs in configs/<id>.json, and an
    // explicit path is workspace data in files/<id>/<path>
    private isAppGlobalConfig(id: string): boolean {
        return id === "app-settings" || id.startsWith("shell-");
    }

    private configFileFor(id: string, configPath?: string): string {
        if (configPath) {
            // panel workspace JSON: the path is panel-relative and the
            // resolver refuses anything that climbs out of the panel dir
            return resolveSecureTargetPath(this.filesDir, configPath, id);
        }
        if (this.isAppGlobalConfig(id)) {
            return path.join(this.localDir, this.configFileName(id));
        }
        return path.join(this.configsDir, this.configFileName(id));
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
        this.requireNoRuntimeReplacement(shell);
        const resolvedCwd = this.resolveSpawnCwd(cwd);
        logger.debug(`[Paperboard Server] creating terminal ${id} (shell=${shell} cwd=${resolvedCwd})`);

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
            { onData, onExit: (code) => {
                this.clients.delete(id);
                this.workloadEnded(id);
                onExit?.(code);
            } },
        );
        this.clientCommands.set(id, shell);
    }

    public writeTerminal(id: string, data: string): void {
        this.clients.get(id)?.write(data);
    }

    public resizeTerminal(id: string, cols: number, rows: number): void {
        this.clients.get(id)?.resize(cols, rows);
    }

    public async destroyTerminal(id: string): Promise<void> {
        const client = this.clients.get(id);
        if (client) {
            await this.stopOwnedClient(id, client);
        }
        this.forgetClientOwner(id);
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
        return (await this.startProcess(id, command, args, cwd, env, onData, onStdout, onStderr)).completion;
    }

    public async startProcess(
        id: string, command: string, args: string[] = [], cwd?: string, env?: Record<string, string>,
        onData?: (data: string) => void, onStdout?: (data: string) => void, onStderr?: (data: string) => void,
    ): Promise<{ completion: Promise<{ exitCode: number }> }> {
        if (!id || typeof id !== "string") {
            throw new Error("process id is required");
        }
        // a staged update of this workload's runtime lands before it starts,
        // when nothing else still runs from the installed release
        const runtime = this.packageOfCommand(command);
        if (runtime) {
            await this.applyStagedPackage(runtime).catch((err) =>
                // recorded in swapFailures; the rolled-back release is intact
                logger.warn(`[engine] starting ${id} on the installed ${runtime}; its staged update failed:`, err),
            );
        }
        this.requireNoRuntimeReplacement(command);
        const resolvedCwd = this.resolveSpawnCwd(cwd);

        let resolveExit!: (result: { exitCode: number }) => void;
        const completion = new Promise<{ exitCode: number }>((resolve) => { resolveExit = resolve; });
        await spawnSupervisedClient(
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
                        this.workloadEnded(id);
                        resolveExit({ exitCode });
                    },
                },
            );
        this.clientCommands.set(id, command);
        return { completion };
    }

    private requireNoRuntimeReplacement(command: string): void {
        const runtime = this.packageOfCommand(command);
        if (runtime && this.swapping.has(runtime)) {
            throw new Error(`The shared runtime "${runtime}" is being replaced; wait for it to finish before starting workloads`);
        }
    }

    public writeProcess(id: string, data: string): void {
        const client = this.clients.get(id);
        // a write to a process that is gone is a failure, not a delivery
        if (!client) throw new Error(`Process "${id}" is not running`);
        client.write(data);
    }

    public async killProcess(id: string, signal: string = "SIGTERM"): Promise<void> {
        const client = this.clients.get(id);
        if (!client) {
            this.forgetClientOwner(id);
            return;
        }
        await this.stopOwnedClient(id, client, signal);
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
        const resolved = this.resolveSecureTargetPath(targetPath, appId);
        // a panel's home belongs to the panel from the start: handing out a
        // path to a home that does not exist made a fresh panel's first
        // spawn/listing fail with "spawn cwd does not exist"
        this.resolveAppFilesDir(appId);
        return resolved;
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
        const fd = openResolvedFile(fullPath, () => this.resolveSecureTargetPath(targetPath, appId), fs.constants.O_WRONLY | fs.constants.O_CREAT);
        try { fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, content, "utf-8"); }
        finally { fs.closeSync(fd); }
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
        const fd = openResolvedFile(fullPath, () => this.resolveSecureTargetPath(targetPath, appId));
        try {
            const stat = fs.fstatSync(fd);
            if (stat.size > FILE_READ_MAX_BYTES) {
                throw new LimitError(`File exceeds ${FILE_READ_MAX_BYTES} byte read cap: ${targetPath}`);
            }
            return fs.readFileSync(fd, "utf-8");
        } finally { fs.closeSync(fd); }
    }

    public async clearFiles(appId?: string): Promise<boolean> {
        const base = this.resolveAppFilesDir(appId);
        if (fs.existsSync(base)) {
            await fs.promises.rm(base, { recursive: true, force: true });
        }
        return true;
    }

    // Recovers running supervisor clients from previous sessions
    // Reconnects supervisors that outlived the previous daemon, keyed by the
    // id their metadata records (the endpoint name is a digest of it, never
    // an id). A supervisor whose metadata does not belong to its file name is
    // skipped rather than adopted under the wrong id.
    public recoverRunningSupervisors(): Promise<void> {
        this.recovery = this.adoptRunningSupervisors();
        return this.recovery;
    }

    private async adoptRunningSupervisors(): Promise<void> {
        const socketsDir = getSocketsDir();
        if (!fs.existsSync(socketsDir)) return;
        let files: string[];
        try {
            files = await fs.promises.readdir(socketsDir);
        } catch (err) {
            logger.warn("[Paperboard Server] failed to list running supervisors:", err);
            return;
        }
        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const stem = file.slice(0, -".json".length);
            let id: unknown;
            let command: unknown;
            try {
                const meta = JSON.parse(await fs.promises.readFile(path.join(socketsDir, file), "utf8"));
                id = meta?.id;
                command = meta?.config?.command;
            } catch (err) {
                logger.warn(`[Paperboard Server] unreadable supervisor metadata ${file}; not adopting it:`, err);
                continue;
            }
            if (typeof id !== "string" || !id || this.clients.has(id)) continue;
            if (stem !== supervisorEndpointName(id)) {
                logger.warn(`[Paperboard Server] supervisor metadata ${file} names "${id}", which does not own that endpoint; not adopting it`);
                continue;
            }
            const client = new SupervisedProcessClient(id, supervisorSocketPathForName(stem));
            if (await client.connect()) {
                this.clients.set(id, client);
                this.clientCommands.set(id, typeof command === "string" ? command : null);
                client.on("exit", () => {
                    if (this.clients.get(id) !== client) return;
                    this.clients.delete(id);
                    this.workloadEnded(id);
                });
            } else {
                client.destroy();
            }
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
        // validated like downloadPackage: a name is a directory under
        // packages/, never a path that climbs out of it
        packageName = this.sanitizeIdOrThrow(packageName, "package");
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
                    "[Paperboard Server] package index.json could not be read:",
                    err,
                );
                throw err;
            }
        }
        return {};
    }

    public getPackagePath(packageName: string): string {
        const base = path.join(this.packagesDir, this.sanitizeIdOrThrow(packageName, "package"));
        const found = this.findBinDir(base, 4);
        return found || base;
    }

    // Recursively searches for a bin/ dir, up to maxDepth levels
    private findBinDir(dir: string, maxDepth: number): string | null {
        return findBinDir(dir, maxDepth);
    }

    // ─── shared runtime replacement ─────────────────────────────────────

    private stagedDir(name: string): string {
        return path.join(this.packagesDir, `.staged-${name}`);
    }

    private stagedRecordFile(name: string): string {
        return path.join(this.packagesDir, `.staged-${name}.json`);
    }

    // the package a command runs from, null when it is not inside one. A
    // bare name ("java") is a PATH lookup and names no package.
    private packageOfCommand(command: string | null | undefined): string | null {
        if (typeof command !== "string" || !path.isAbsolute(command)) return null;
        const rel = path.relative(this.packagesDir, path.resolve(command));
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
        const name = rel.split(path.sep)[0];
        return name && !name.startsWith(".") ? name : null;
    }

    // live workloads running from the installed release of a package. One
    // whose command is unknown counts against every package. A binary a
    // shell runs by hand is not seen: on Linux and macOS it keeps its open
    // files across the swap, on Windows the rename fails and rolls back.
    private packageUsers(name: string): Array<{ processId: string; owner: string | null }> {
        const users: Array<{ processId: string; owner: string | null }> = [];
        for (const id of this.clients.keys()) {
            const command = this.clientCommands.get(id);
            if (command == null || this.packageOfCommand(command) === name) {
                users.push({ processId: id, owner: this.clientOwners.get(id) ?? null });
            }
        }
        return users;
    }

    private packageUpdateWait(name: string): PackageUpdateWait | null {
        const staged = this.stagedPackages.get(name);
        if (staged) return { name, version: staged.version, blockedBy: this.packageUsers(name) };
        const failed = this.swapFailures.get(name);
        return failed ? { name, version: failed.version, blockedBy: [], error: failed.error } : null;
    }

    /** Package updates that are downloaded but not installed yet. */
    public pendingPackageUpdates(): PackageUpdateWait[] {
        const names = new Set([...this.stagedPackages.keys(), ...this.swapFailures.keys()]);
        return [...names].map((name) => this.packageUpdateWait(name)!);
    }

    private async stagePackage(release: StagedPackage, srcDir: string): Promise<void> {
        const name = release.name;
        if (!this.stagedPackages.has(name) && this.stagedPackages.size >= MAX_STAGED_PACKAGES) {
            throw new LimitError(`Too many staged package updates (max ${MAX_STAGED_PACKAGES})`);
        }
        // the record goes first and comes back last, so a record on disk
        // always describes the bytes beside it
        this.stagedPackages.delete(name);
        fs.rmSync(this.stagedRecordFile(name), { force: true });
        await fs.promises.rm(this.stagedDir(name), { recursive: true, force: true });
        await fs.promises.rename(srcDir, this.stagedDir(name));
        writeJsonAtomicSync(this.stagedRecordFile(name), release);
        this.stagedPackages.set(name, release);
        this.swapFailures.delete(name);
    }

    // swap in place: the previous release is parked only until the
    // replacement is indexed, then it is gone. A failed swap rolls it back;
    // nothing is retained after success.
    private async swapPackage(release: StagedPackage, srcDir: string): Promise<void> {
        const name = release.name;
        const targetDir = path.join(this.packagesDir, name);
        const index = this.getPackageIndex();
        index[name] = {
            name,
            version: release.version,
            sha256: release.sha256,
            installedAt: new Date().toISOString(),
        };
        this.swapping.add(name);
        try {
            const previous = path.join(this.packagesDir, `.replaced-${Date.now()}-${name}`);
            if (fs.existsSync(targetDir)) await fs.promises.rename(targetDir, previous);
            try {
                await fs.promises.rename(srcDir, targetDir);
                writeJsonAtomicSync(path.join(this.packagesDir, "index.json"), index);
            } catch (err) {
                if (fs.existsSync(targetDir)) await fs.promises.rm(targetDir, { recursive: true, force: true });
                if (fs.existsSync(previous)) await fs.promises.rename(previous, targetDir);
                throw err;
            }
            await fs.promises
                .rm(previous, { recursive: true, force: true })
                .catch((err) => logger.warn("[engine] previous package copy could not be removed:", err));
        } finally {
            this.swapping.delete(name);
        }
        this.swapFailures.delete(name);
    }

    // installs a staged release once no workload runs from the installed
    // one; concurrent callers share the swap in flight
    private async applyStagedPackage(name: string): Promise<void> {
        await this.recovery;
        const inFlight = this.swaps.get(name);
        if (inFlight) return inFlight;
        const release = this.stagedPackages.get(name);
        if (!release || this.packageUsers(name).length > 0) return;
        const swap = (async () => {
            try {
                await this.swapPackage(release, this.stagedDir(name));
                logger.info(`[package:${name}] installed the staged ${release.version}`);
            } catch (err) {
                // the installed release was rolled back in place and keeps
                // working; the update is a recorded failure, never installed
                const error = err instanceof Error ? err.message : String(err);
                this.swapFailures.set(name, { version: release.version, error });
                logger.error(`[package:${name}] could not install the staged ${release.version}:`, err);
                await fs.promises
                    .rm(this.stagedDir(name), { recursive: true, force: true })
                    .catch((rmErr) => logger.warn(`[package:${name}] staged copy could not be removed:`, rmErr));
                throw err;
            } finally {
                this.stagedPackages.delete(name);
                fs.rmSync(this.stagedRecordFile(name), { force: true });
            }
        })().finally(() => this.swaps.delete(name));
        this.swaps.set(name, swap);
        return swap;
    }

    /** Installs every staged update no workload holds back. */
    public async applyReadyStagedPackages(): Promise<void> {
        await Promise.all(
            [...this.stagedPackages.keys()].map((name) =>
                // a failed swap is recorded in swapFailures and surfaces
                // through pendingPackageUpdates
                this.applyStagedPackage(name).catch((err) =>
                    logger.debug(`[package:${name}] staged swap failed (recorded):`, err),
                ),
            ),
        );
    }

    // a workload is gone: its runtime may now be free to update
    private workloadEnded(id: string): void {
        this.clientCommands.delete(id);
        this.forgetClientOwner(id);
        if (this.stagedPackages.size > 0) void this.applyReadyStagedPackages();
    }

    private supervisorCommand(id: string): string | null {
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(getSocketsDir(), `${supervisorEndpointName(id)}.json`), "utf8"));
            return typeof meta?.config?.command === "string" ? meta.config.command : null;
        } catch (err) {
            logger.warn(`[engine] supervisor metadata for ${id} is unreadable; its runtime is unknown and blocks package updates:`, err);
            return null;
        }
    }

    public async downloadPackage(
        packageName: string,
        _downloadId: string,
        onProgress?: ProgressCallback,
        expectedSha256?: string,
    ): Promise<PackageInstallOutcome> {
        const key = `package:${this.sanitizeIdOrThrow(packageName, "package")}`;
        if (this.operations.has(key)) throw new Error(`An operation on ${packageName} is already running`);
        if (this.operations.size >= 8) throw new LimitError("Too many concurrent installs");
        this.operations.add(key);
        try { return await this.installPackageRelease(packageName, onProgress, expectedSha256); }
        finally { this.operations.delete(key); }
    }

    private async installPackageRelease(packageName: string, onProgress?: ProgressCallback, expectedSha256?: string): Promise<PackageInstallOutcome> {
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

        const targetDir = path.join(this.packagesDir, packageName);
        if (this.getPackageIndex()[packageName]?.sha256 === expectedSha256 && this.findBinDir(targetDir, 4)) {
            onProgress?.({ stage: "completed", percent: 100, message: "Requested release is installed" });
            return { path: targetDir };
        }
        // already downloaded and verified, still waiting on its workloads:
        // swap it now if they are gone, never download the same bytes again
        if (this.stagedPackages.get(packageName)?.sha256 === expectedSha256) {
            await this.applyStagedPackage(packageName);
            const waiting = this.packageUpdateWait(packageName);
            onProgress?.({ stage: "completed", percent: 100, message: waiting ? "Update waits for running workloads" : "Installed successfully" });
            return waiting ? { path: targetDir, waiting } : { path: targetDir };
        }
        const pkgDir = `${targetDir}.staging-${Date.now()}`;

        const metaUrl = `${this.registryUrl}/package/${encodeURIComponent(packageName)}.json`;
        log(`resolving ${metaUrl}`);
        onProgress?.({
            stage: "checking",
            percent: 0,
            message: `Resolving package ${packageName}...`,
        });

        let meta: any;
        try {
            meta = await fetchRegistryRecord(metaUrl);
        } catch (err) {
            throw new Error(`Install refused for package "${packageName}": registry record unavailable (${err instanceof Error ? err.message : String(err)})`);
        }

        const currentOs =
            process.platform === "win32"
                ? "windows"
                : process.platform === "darwin"
                  ? "macos"
                  : "linux";
        const currentArch = process.arch === "arm64" ? "arm64" : "x64";
        const platformKey = `${currentOs}-${currentArch}`;
        // only the platforms map is a release record: the signature covers
        // (name, version, platform, sha256) of exactly that entry
        const downloadInfo = meta?.platforms?.[platformKey];
        if (!downloadInfo?.url) {
            throw new Error(
                `No download available for ${packageName} on ${platformKey}`,
            );
        }
        if (typeof meta.version !== "string" || !meta.version) {
            throw new Error(`Install refused for package "${packageName}": registry did not provide a version`);
        }
        log(`source: ${downloadInfo.url}`);
        // the caller's checksum fact must agree with the record; a mismatch
        // (or a record without one) means one of the two sources is lying
        if (typeof downloadInfo.sha256 !== "string" || downloadInfo.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
            throw new Error(
                `Install refused for package "${packageName}": checksum mismatch between update plan and registry metadata`,
            );
        }
        requireReleaseSignature(
            releaseMessage.package(packageName, meta.version, platformKey, downloadInfo.sha256),
            downloadInfo.signature,
            `package "${packageName}"`,
            this.releaseKey,
        );

        // refused before any download: a layout this daemon does not know
        // would install binaries where no caller looks for them
        const layout = parsePackageLayout(downloadInfo.layout);
        // keep the URL extension so extraction dispatches on format
        const urlExt = packageArchiveSuffix(downloadInfo.url);
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
            await extractPackageArchive(tempArchive, pkgDir, layout, urlExt);
            log(
                `extraction complete; bin present: ${this.findBinDir(pkgDir, 4) !== null}`,
            );

            // require bin/ before indexing, else remove and fail
            if (!this.findBinDir(pkgDir, 4)) {
                await fs.promises.rm(pkgDir, { recursive: true, force: true });
                throw new Error(
                    `Package ${packageName} extracted but no usable binary directory was found. Removed partial install.`,
                );
            }

            const release: StagedPackage = { name: packageName, version: meta.version, sha256: expectedSha256 };
            // Runtimes are shared host resources: a workload running from
            // the installed release keeps it. The verified release is staged
            // beside it and swapped in once the last of them exits.
            if (fs.existsSync(targetDir) && this.packageUsers(packageName).length > 0) {
                await this.stagePackage(release, pkgDir);
                const waiting = this.packageUpdateWait(packageName)!;
                log(`staged ${meta.version}; waiting for ${waiting.blockedBy.length} workload(s) to stop`);
                onProgress?.({ stage: "completed", percent: 100, message: "Update waits for running workloads" });
                return { path: targetDir, waiting };
            }
            await this.swapPackage(release, pkgDir);

            onProgress?.({
                stage: "completed",
                percent: 100,
                message: "Installed successfully",
            });
            return { path: targetDir };
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

        for (const entry of entries) {
            if (entry.startsWith(".")) continue;
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
                        ...(isDevLink ? { installSource: "dev" as const } : {}),
                    } as PanelManifest);
                } catch (err) {
                    logger.debug(
                        `[Paperboard Server] panel manifest for ${entry} failed validation/read:`,
                        err,
                    );
                }
            }
        }
        return panels;
    }

    /** Panel service children that have not exited. */
    public runningServiceCount(): number {
        return this.services.runningCount();
    }

    // Installs the registry's current release of a panel. The daemon asks
    // its own registry which release that is and which bytes are right, and
    // downloads only from the registry: a caller names the panel and may
    // state what it expects, never where the bytes come from.
    public async installPanel(
        panelId: string,
        expected: ExpectedPanelRelease = {},
    ): Promise<PanelManifest> {
        const key = `panel:${requirePanelId(panelId)}`;
        if (this.operations.has(key)) throw new Error(`An operation on ${panelId} is already running`);
        if (this.operations.size >= 8) throw new LimitError("Too many concurrent installs");
        this.operations.add(key);
        try { return await this.installPanelRelease(panelId, expected); }
        finally { this.operations.delete(key); }
    }

    // the registry record is the authority for the release; any caller
    // expectation that disagrees with it refuses the install
    private async resolvePanelRelease(id: string, expected: ExpectedPanelRelease): Promise<{ version: string; sha256: string }> {
        let raw: any;
        try {
            raw = await fetchRegistryRecord(`${this.registryUrl}/panel/${encodeURIComponent(id)}.json`);
        } catch (err) {
            throw new Error(`Install refused for "${id}": registry record unavailable (${err instanceof Error ? err.message : String(err)})`);
        }
        if (raw?.id !== id) throw new Error(`Install refused for "${id}": the registry record names a different panel`);
        if (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sha256)) {
            throw new Error(`Install refused for "${id}": registry did not provide a sha256 checksum`);
        }
        if (typeof raw.version !== "string" || !raw.version) {
            throw new Error(`Install refused for "${id}": registry did not provide a version`);
        }
        const sha256 = raw.sha256.toLowerCase();
        // the registry's facts count only when the offline release key
        // signed them: a registry compromise cannot list its own bytes
        requireReleaseSignature(releaseMessage.panel(id, raw.version, sha256), raw.signature, `"${id}"`, this.releaseKey);
        if (expected.sha256 !== undefined && expected.sha256.toLowerCase() !== sha256) {
            throw new Error(`Install refused for "${id}": the registry now lists different bytes than the release requested`);
        }
        if (expected.version !== undefined && expected.version !== raw.version) {
            throw new Error(`Install refused for "${id}": requested version ${expected.version}, the registry lists ${raw.version}`);
        }
        return { version: raw.version, sha256 };
    }

    private async installPanelRelease(panelId: string, expected: ExpectedPanelRelease): Promise<PanelManifest> {
        const cleanId = requirePanelId(panelId);
        const release = await this.resolvePanelRelease(cleanId, expected);
        const downloadUrl = `${this.registryUrl}/panel/${encodeURIComponent(cleanId)}/download`;
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
                release.sha256,
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

            // the archive must say what it is, and agree with the request
            // and the registry record, before anything activates
            const manifestFile = this.findManifestFile(contentDir);
            if (!manifestFile) {
                throw new Error(`Install refused for "${cleanId}": the archive has no manifest.json`);
            }
            const rawManifest = JSON.parse(await fs.promises.readFile(manifestFile, "utf-8"));
            if (rawManifest?.id !== cleanId) {
                throw new Error(`Install refused for "${cleanId}": the archive's manifest names ${JSON.stringify(rawManifest?.id)}`);
            }
            if (rawManifest.version !== release.version) {
                throw new Error(`Install refused for "${cleanId}": the archive is version ${JSON.stringify(rawManifest.version)}, the registry lists ${release.version}`);
            }
            const manifest = validatePanelManifest(rawManifest, cleanId);

            await this.services.stopService(cleanId);
            for (const [id, client] of [...this.clients]) {
                if (this.clientOwners.get(id) === cleanId) await this.stopOwnedClient(id, client);
            }

            // atomic swap into place: the live dir is parked only until the
            // replacement activates. A failed activation removes the new
            // release and restores the previous one in place; a successful
            // one leaves no copy behind.
            const previousDir = path.join(this.panelsDir, `.replaced-${Date.now()}-${cleanId}`);
            if (fs.existsSync(targetDir)) {
                await fs.promises.rename(targetDir, previousDir);
            }
            try {
                await moveFileSafe(contentDir, targetDir);
                if (this.services.startService(cleanId)) await this.services.waitUntilReady(cleanId);
            } catch (err) {
                await this.services.stopService(cleanId);
                if (fs.existsSync(targetDir)) await fs.promises.rm(targetDir, { recursive: true, force: true });
                if (fs.existsSync(previousDir)) {
                    await fs.promises.rename(previousDir, targetDir);
                    if (this.services.startService(cleanId)) await this.services.waitUntilReady(cleanId);
                }
                throw err;
            }
            await fs.promises
                .rm(previousDir, { recursive: true, force: true })
                .catch((err) => logger.warn("[engine] previous panel copy could not be removed:", err));
            await fs.promises
                .rm(stagingDir, { recursive: true, force: true })
                .catch((err) => logger.debug("[engine] staging cleanup failed:", err));


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

    /** Restarts only the panel's service child. Workloads it started through
     * process:run/terminals are daemon-owned clients and keep running.
     * Resolves true once the new generation reports ready, false when the
     * panel declares no service. */
    public async restartPanelService(panelId: string): Promise<boolean> {
        const cleanId = requirePanelId(panelId);
        const key = `panel:${cleanId}`;
        if (this.operations.has(key)) throw new Error(`An operation on ${cleanId} is already running`);
        if (!fs.existsSync(path.join(this.panelsDir, cleanId))) throw new Error(`Panel ${cleanId} is not installed`);
        this.operations.add(key);
        try {
            await this.services.stopService(cleanId);
            if (!this.services.startService(cleanId)) return false;
            await this.services.waitUntilReady(cleanId);
            return true;
        } finally { this.operations.delete(key); }
    }

    // ─── Panel data, for backups ─────────────────────────────────────────

    /** a panel's backed-up data, relative to the data dir: its file storage
     * and its config document. Vault secrets are not panel data here. */
    public panelDataEntries(panelId: string): { files: string; config: string } {
        const cleanId = requirePanelId(panelId);
        return {
            files: path.posix.join("files", panelFilesDirName(cleanId)),
            config: path.posix.join("configs", this.configFileName(cleanId)),
        };
    }

    /** the installed panel's manifest version, null when it declares none */
    public installedPanelVersion(panelId: string): string | null {
        const cleanId = requirePanelId(panelId);
        const manifestFile = this.findManifestFile(path.join(this.panelsDir, cleanId));
        if (!manifestFile) throw new Error(`Panel ${cleanId} is not installed`);
        const version = JSON.parse(fs.readFileSync(manifestFile, "utf-8"))?.version;
        return typeof version === "string" ? version : null;
    }

    /** runs fn holding the panel's operation lock (install, restart,
     * uninstall, backup and restore exclude each other) */
    public async withPanelOperation<T>(panelId: string, fn: () => Promise<T>): Promise<T> {
        const cleanId = requirePanelId(panelId);
        const key = `panel:${cleanId}`;
        if (this.operations.has(key)) throw new RpcError(ErrorCode.CONFLICT, `An operation on ${cleanId} is already running`);
        this.operations.add(key);
        try {
            return await fn();
        } finally {
            this.operations.delete(key);
        }
    }

    private readonly dataDeletedListeners = new Set<(panelId: string) => void | Promise<void>>();

    /** runs `listener` when an uninstall deletes a panel's data; returns the
     * unsubscribe, which the subscriber calls when it is disposed */
    public onPanelDataDeleted(listener: (panelId: string) => void | Promise<void>): () => void {
        this.dataDeletedListeners.add(listener);
        return () => this.dataDeletedListeners.delete(listener);
    }

    /** asks the panel's running service to get ready for a backup of its
     * data, when it takes part; see PanelServicesManager.prepareForBackup */
    public prepareServiceForBackup(panelId: string): Promise<boolean> {
        return this.services.prepareForBackup(requirePanelId(panelId));
    }

    /** runs fn (a backup copying the panel's data) with the panel's service
     * stopped, so the copy is not taken mid-write, then starts the service
     * again if it was running and waits for it to be ready. A service that
     * does not come back fails the call. Call inside withPanelOperation. */
    public async withServicePaused<T>(panelId: string, fn: () => Promise<T>): Promise<T> {
        const cleanId = requirePanelId(panelId);
        const wasActive = this.services.isActive(cleanId);
        if (wasActive) await this.services.stopService(cleanId);
        let result: T;
        try {
            result = await fn();
        } finally {
            if (wasActive && this.services.startService(cleanId)) await this.services.waitUntilReady(cleanId);
        }
        return result;
    }

    /**
     * Replaces a panel's file storage and config document with staged
     * copies (a restore). The service and the processes the panel owns are
     * stopped and observed exiting first. The live data is parked only
     * until the panel is ready on the new data (a service that was not
     * running stays stopped): a failure puts the parked
     * data back in place and restarts the panel on it. Call inside
     * withPanelOperation.
     */
    public async replacePanelData(panelId: string, staged: { filesDir: string; configFile: string | null }): Promise<void> {
        const cleanId = requirePanelId(panelId);
        if (!fs.existsSync(path.join(this.panelsDir, cleanId))) throw new Error(`Panel ${cleanId} is not installed`);
        const entries = this.panelDataEntries(cleanId);
        const liveFiles = path.join(this.appDataDir, entries.files);
        const liveConfig = path.join(this.appDataDir, entries.config);
        const stamp = `${Date.now()}`;
        const parkedFiles = path.join(this.filesDir, `.restore-parked-${stamp}-${path.basename(liveFiles)}`);
        const parkedConfig = path.join(this.configsDir, `.restore-parked-${stamp}-${path.basename(liveConfig)}`);

        const wasActive = this.services.isActive(cleanId);
        const hadFiles = fs.existsSync(liveFiles);
        const hadConfig = fs.existsSync(liveConfig);
        let parkedFilesDone = false;
        let parkedConfigDone = false;
        let installing = false;
        try {
            await this.services.stopService(cleanId);
            for (const [id, client] of [...this.clients]) {
                if (this.clientOwners.get(id) === cleanId) await this.stopOwnedClient(id, client);
            }
            if (hadFiles) {
                await fs.promises.rename(liveFiles, parkedFiles);
                parkedFilesDone = true;
            }
            if (hadConfig) {
                await fs.promises.rename(liveConfig, parkedConfig);
                parkedConfigDone = true;
            }
            installing = true;
            await moveFileSafe(staged.filesDir, liveFiles);
            if (staged.configFile) await moveFileSafe(staged.configFile, liveConfig);
            if (wasActive && this.services.startService(cleanId)) await this.services.waitUntilReady(cleanId);
        } catch (err) {
            // anything from the stop onward leaves the previous data in
            // place and the panel running on it again
            try {
                await this.services.stopService(cleanId);
                if (installing) {
                    await fs.promises.rm(liveFiles, { recursive: true, force: true });
                    await fs.promises.rm(liveConfig, { force: true });
                }
                if (parkedFilesDone) await fs.promises.rename(parkedFiles, liveFiles);
                if (parkedConfigDone) await fs.promises.rename(parkedConfig, liveConfig);
            } catch (rollbackErr) {
                throw new Error(
                    `The restore failed (${(err as Error).message}) and the previous data of ${cleanId} could not be put back (${(rollbackErr as Error).message}); it is parked at ${parkedFiles} and ${parkedConfig}`,
                    { cause: err },
                );
            }
            // the restore's failure is the answer; a panel that also fails
            // to come back on its own data is logged, not swallowed
            try {
                if (wasActive && this.services.startService(cleanId)) await this.services.waitUntilReady(cleanId);
            } catch (restartErr) {
                logger.error(`[engine] ${cleanId} did not restart on its previous data after a failed restore:`, restartErr);
            }
            throw err;
        }
        await fs.promises
            .rm(parkedFiles, { recursive: true, force: true })
            .catch((err) => logger.warn("[engine] parked panel files could not be removed:", err));
        await fs.promises
            .rm(parkedConfig, { force: true })
            .catch((err) => logger.warn("[engine] parked panel config could not be removed:", err));
    }

    public async uninstallPanel(panelId: string, options?: { deleteData?: boolean }): Promise<boolean> {
        const cleanId = requirePanelId(panelId);
        const key = `panel:${cleanId}`;
        if (this.operations.has(key)) throw new Error(`An operation on ${cleanId} is already running`);
        this.operations.add(key);
        try {
        await this.services.stopService(cleanId);

        // Resource identity comes from the ownership ledger. Legacy IDs
        // require an explicit migration; a name is not proof of ownership.
        for (const [id, client] of this.clients.entries()) {
            if (this.clientOwners.get(id) === cleanId) {
                await this.stopOwnedClient(id, client);
            }
        }

        const panelDir = path.join(this.panelsDir, cleanId);
        if (fs.existsSync(panelDir)) {
            // uninstall removes the code, not the user's data; the workload
            // is already stopped and its exit observed above
            await fs.promises.rm(panelDir, { recursive: true, force: true });
        }
        // Uninstall removes code, not user data by default. Config, files
        // and vault entries remain in their restricted stores for a later
        // reinstall. a removed panel stops authenticating immediately: its
        // scoped token is revoked, not left lingering in the vault
        this.services.revokePanel(cleanId);

        if (options?.deleteData === true) {
            // explicit opt-in: the panel's config document, workspace files
            // and vault entries are deleted with the code
            await fs.promises.rm(this.configFileFor(cleanId), { force: true });
            await fs.promises.rm(path.join(this.filesDir, panelFilesDirName(cleanId)), { recursive: true, force: true });
            this.credentialsStore.purge(cleanId);
            // what other owners keep about the panel (its routine backups)
            // goes with its data; their failure is the uninstall's failure
            for (const listener of [...this.dataDeletedListeners]) {
                await listener(cleanId);
            }
        }

        return true;
        } finally { this.operations.delete(key); }
    }

    private async stopOwnedClient(id: string, client: SupervisedProcessClient, signal = "SIGTERM"): Promise<void> {
        if (client.isConnected()) {
            let exited = false;
            const onExit = () => { exited = true; };
            client.on("exit", onExit);
            try {
                client.kill(signal);
                const started = Date.now();
                let escalated = false;
                while (!exited) {
                    if (!escalated && Date.now() - started >= 3000) { client.kill("SIGKILL"); escalated = true; }
                    if (Date.now() - started >= 6000) throw new Error(`Process ${id} did not stop; removal refused`);
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
            } finally { client.off("exit", onExit); }
        }
        client.destroy();
        this.clients.delete(id);
        this.workloadEnded(id);
    }

    public async getConfig(id: string, configPath?: string): Promise<any> {
        // service-owned boundary: traversal ids throw before touching disk
        this.sanitizeIdOrThrow(id, "config");
        const files = [this.configFileFor(id, configPath)];
        for (const file of files) {
            if (fs.existsSync(file)) {
                try {
                    const data = JSON.parse(await fs.promises.readFile(file, "utf-8"));
                    const current = this.configFileFor(id, configPath);
                    if (file !== current) await writeFileAtomic(current, JSON.stringify(data));
                    return data;
                } catch (err) {
                    logger.error(`[Paperboard Server] config read failed for ${id}:`, err);
                    throw err;
                }
            }
        }
        return null;
    }

    public async setConfig(id: string, data: any, configPath?: string): Promise<boolean> {
        // service-owned boundary: traversal ids throw before touching disk
        this.sanitizeIdOrThrow(id, "config");
        // bounded payload: config is small structured state, never a blob
        // store — 1 MiB serialized refuses before the atomic write
        const serialized = JSON.stringify(data, null, 2);
        if (Buffer.byteLength(serialized, "utf8") > CONFIG_MAX_BYTES) {
            throw new LimitError(
                `Config "${id}" exceeds ${CONFIG_MAX_BYTES} byte payload cap`,
            );
        }
        const file = this.configFileFor(id, configPath);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, serialized);
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

    public listSecrets(panelId?: string): string[] {
        return this.credentialsStore.list(panelId);
    }

    public purgeSecrets(panelId: string): number {
        return this.credentialsStore.purge(panelId);
    }
}
