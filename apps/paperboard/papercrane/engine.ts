// The daemon's engine: one facade over the workloads (engineWorkloads.ts),
// the runtime packages (enginePackages.ts) and the installed panels
// (enginePanels.ts), plus the panel files, configs and secrets it serves
import path from "path";
import fs from "fs";
import { hashFile, moveFileSafe, writeFileAtomic, LimitError } from "./storage";
import { resolveSecureTargetPath, openResolvedFile } from "./pathContainment";
import { ProgressCallback, streamToFileWithProgress } from "./download";
import { getPaperboardDir } from "./paths";
import { extractArchive } from "./engineArchives";
import { panelServices, PanelServicesManager } from "./panelServices";
import { CredentialStore } from "./credentials";
import { logger } from "./logger";
import { resolveRegistryUrl } from "./util";
import { daemonReleaseKey } from "./releaseSignature";
import type { MonitorLifecycle } from "../../../packages/paperapi/src/monitorProtocol";
import type { BackupEnded } from "./backups/types";
import { requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import { WorkloadRegistry, type ProcessStreams, type TerminalStreams } from "./engineWorkloads";
import { PackageManager, sanitizeIdOrThrow, type PackageInstallOutcome, type PackageUpdateWait, type ReleaseSource } from "./enginePackages";
import { PanelInstaller, type ExpectedPanelRelease, type UninstallResult } from "./enginePanels";
import type { PanelManifest } from "./types";
import { errorCode } from "../../../packages/paperapi/src/errors";

export type { ProcessStreams, TerminalStreams } from "./engineWorkloads";
export type { StagedPackage, PackageUpdateWait, PackageInstallOutcome } from "./enginePackages";
export type { ExpectedPanelRelease, UninstallResult } from "./enginePanels";

export const REGISTRY_URL = resolveRegistryUrl();

// the algorithms a file:download checksum may name
export const DOWNLOAD_CHECKSUM_ALGORITHMS = ["sha1", "sha256", "sha512"];

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
    private services: PanelServicesManager;
    private workloads: WorkloadRegistry;
    private packages: PackageManager;
    private panels: PanelInstaller;
    private registry: ReleaseSource;

    // registryUrl and releaseKey are fixed in production; tests point them
    // at a loopback registry signed with a fixture key, in process or
    // through the same environment the daemon's own updates honor
    constructor(
        baseDir?: string,
        services?: PanelServicesManager,
        registryUrl = REGISTRY_URL,
        releaseKey = daemonReleaseKey(),
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
        // every package and panel operation holds one of these locks
        const operations = new Set<string>();
        this.registry = { url: registryUrl, key: releaseKey };
        this.packages = new PackageManager(this.packagesDir, this.panelsDir, operations, this.registry);
        this.workloads = new WorkloadRegistry(this.localDir, this.packages);
        this.packages.useWorkloads(this.workloads);
        this.panels = new PanelInstaller(
            { appDataDir: this.appDataDir, panelsDir: this.panelsDir, filesDir: this.filesDir, configsDir: this.configsDir },
            operations, this.services, this.workloads, this.packages, this.credentialsStore, this.registry,
        );
    }

    // Removes interrupted download/install artifacts (*.tmp-*, *.staging-*,
    // and writeFileAtomic's *.<12 hex>.tmp)
    // and recovers swaps a crash interrupted (parkedSwap.ts), in packages,
    // panel releases and restored panel data.
    //
    // Explicit, NOT in the constructor: sweeping deletes live temp files,
    // so it must only run after this instance owns its port. A second
    // daemon constructed during a port race (see index.ts tryStart) must
    // never sweep the first daemon's in-flight downloads.
    public sweepStartupOrphans(): void {
        for (const dir of [this.packagesDir, this.panelsDir]) {
            try {
                for (const entry of fs.readdirSync(dir)) {
                    if (/\.(tmp|staging)-\d+|\.[0-9a-f]{12}\.tmp$/.test(entry)) {
                        fs.rmSync(path.join(dir, entry), {
                            recursive: true,
                            force: true,
                        });
                    }
                }
            } catch (err) {
                if (errorCode(err) !== "ENOENT") {
                    logger.warn(`[engine] interrupted downloads in ${dir} could not be cleared and stay on disk:`, err);
                }
            }
        }
        this.panels.recoverAtStartup();
        this.packages.recoverAtStartup();
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

    public getAppDataDir(): string {
        return this.appDataDir;
    }

    // Config filenames are built from validated ids only. There is no
    // fallback to raw input: a traversal id must throw here, never shape
    // a path (the RPC boundary refuses it first with INVALID_PARAMS;
    // this throw is the defense for direct engine callers).
    private configFileName(id: string): string {
        return `${sanitizeIdOrThrow(id, "config")}.json`;
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

    public async downloadFile(
        url: string,
        targetPath: string,
        appId: string | undefined,
        options: {
            sha1?: string;
            sha256?: string;
            checksum?: { algorithm: string; value: string };
        } = {},
        onProgress?: ProgressCallback,
    ): Promise<string> {
        // a checksum the daemon cannot check is refused before any network:
        // ignoring it would install bytes nobody verified
        const checksum = options.checksum;
        const algorithm = checksum ? String(checksum.algorithm).toLowerCase() : undefined;
        if (checksum) {
            if (!algorithm || !DOWNLOAD_CHECKSUM_ALGORITHMS.includes(algorithm)) {
                throw new Error(
                    `Download refused: checksum algorithm ${JSON.stringify(checksum.algorithm)} is not supported (use ${DOWNLOAD_CHECKSUM_ALGORITHMS.join(", ")})`,
                );
            }
            if (typeof checksum.value !== "string" || !checksum.value) {
                throw new Error(`Download refused: the ${algorithm} checksum has no value`);
            }
        }
        const finalDest = this.resolveSecureTargetPath(targetPath, appId);
        const tempPath = `${finalDest}.tmp-${Date.now()}`;
        const dir = path.dirname(finalDest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        try {
            await streamToFileWithProgress(
                url,
                tempPath,
                onProgress,
                options.sha1 || (algorithm === "sha1" ? checksum!.value : undefined),
                options.sha256 || (algorithm === "sha256" ? checksum!.value : undefined),
            );
            if (algorithm === "sha512" && (await hashFile(tempPath, "sha512")) !== checksum!.value.toLowerCase()) {
                throw new Error("SHA512 mismatch");
            }

            // the download took a while: containment is proven again right before the move
            await moveFileSafe(tempPath, this.resolveSecureTargetPath(targetPath, appId));
            onProgress?.({ stage: "completed", percent: 100 });
            return finalDest;
        } catch (err: any) {
            if (fs.existsSync(tempPath))
                await fs.promises.unlink(tempPath).catch((err) => logger.warn(`[engine] ${tempPath} was left on disk:`, err));
            onProgress?.({ stage: "error", percent: 0, message: err.message });
            throw err;
        }
    }

    public async getConfig(id: string, configPath?: string): Promise<any> {
        // service-owned boundary: traversal ids throw before touching disk
        sanitizeIdOrThrow(id, "config");
        const file = this.configFileFor(id, configPath);
        if (!fs.existsSync(file)) return null;
        try {
            return JSON.parse(await fs.promises.readFile(file, "utf-8"));
        } catch (err) {
            logger.error(`[Paperboard Server] config read failed for ${id}:`, err);
            throw err;
        }
    }

    public async setConfig(id: string, data: any, configPath?: string): Promise<boolean> {
        // service-owned boundary: traversal ids throw before touching disk
        sanitizeIdOrThrow(id, "config");
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

    public listSecrets(panelId: string): string[] {
        return this.credentialsStore.list(panelId);
    }

    public purgeSecrets(panelId: string): number {
        return this.credentialsStore.purge(panelId);
    }

    public async extractArchive(archivePath: string, destDir: string): Promise<void> {
        return extractArchive(archivePath, destDir);
    }

    // ─── workloads (engineWorkloads.ts) ─────────────────────────────────

    public createTerminal(
        id: string,
        options: { cols?: number; rows?: number; cwd?: string; env?: Record<string, string>; shell?: string },
        streams: TerminalStreams,
        subscriber?: object,
    ): Promise<void> {
        return this.workloads.createTerminal(id, options, streams, subscriber);
    }
    public writeTerminal(id: string, data: string): void { this.workloads.writeTerminal(id, data); }
    public terminalState(id: string): { foreground: string; cwd: string } { return this.workloads.terminalState(id); }
    public resizeTerminal(id: string, cols: number, rows: number): void { this.workloads.resizeTerminal(id, cols, rows); }
    public destroyTerminal(id: string): Promise<void> { return this.workloads.destroyTerminal(id); }
    public attachTerminal(id: string, subscriber: object, streams: TerminalStreams): Promise<boolean> {
        return this.workloads.attachTerminal(id, subscriber, streams);
    }
    public isTerminalRunning(id: string): Promise<boolean> { return this.workloads.isTerminalRunning(id); }
    public startProcess(...args: Parameters<WorkloadRegistry["startProcess"]>): Promise<void> { return this.workloads.startProcess(...args); }
    public writeProcess(id: string, data: string): void { this.workloads.writeProcess(id, data); }
    public closeProcessInput(id: string): void { this.workloads.closeProcessInput(id); }
    public killProcess(id: string, signal = "SIGTERM"): Promise<void> { return this.workloads.killProcess(id, signal); }
    public isProcessRunning(id: string): Promise<boolean> { return this.workloads.isProcessRunning(id); }
    public attachProcess(id: string, subscriber: object, streams?: ProcessStreams): Promise<boolean> { return this.workloads.attachProcess(id, subscriber, streams); }
    public detachStreams(subscriber: object): void { this.workloads.detachStreams(subscriber); }
    public setClientOwner(id: string, owner: string | null): void { this.workloads.setClientOwner(id, owner); }
    public reserveClientOwner(id: string, owner: string | null): { commit(): void; undo(): void } { return this.workloads.reserveClientOwner(id, owner); }
    public clientOwner(id: string): string | null { return this.workloads.clientOwner(id); }
    public holdsUpdates(id: string): boolean { return this.workloads.holdsUpdates(id); }
    public panelWorkloads(panelId: string): string[] { return this.workloads.panelWorkloads(panelId); }
    /** Each live workload's supervisor process and the panel that created it (null: the host). */
    public workloadRoots(): Array<{ owner: string | null; pid: number }> { return this.workloads.workloadRoots(); }
    public recoverRunningSupervisors(): Promise<void> { return this.workloads.recoverRunningSupervisors(); }
    public disposeClients(graceMs = 5000): Promise<void> { return this.workloads.disposeClients(graceMs); }
    public releaseAllClients(): void { this.workloads.releaseAllClients(); }
    public killAllClients(): void { this.workloads.killAllClients(); }

    /** Hears every panel service and workload start and exit from now on
     * (the traffic monitor); returns the unsubscribe. */
    public onLifecycle(listener: (change: MonitorLifecycle) => void): () => void {
        const offWorkloads = this.workloads.onLifecycle(listener);
        const offServices = this.services.onLifecycle(listener);
        return () => {
            offWorkloads();
            offServices();
        };
    }

    // ─── runtime packages (enginePackages.ts) ───────────────────────────

    public isPackageInstalled(packageName: string, version?: string): boolean { return this.packages.isPackageInstalled(packageName, version); }
    public getPackageIndex(): Record<string, any> { return this.packages.getPackageIndex(); }
    public getPackagePath(packageName: string): string { return this.packages.getPackagePath(packageName); }
    public recordPackageUse(packageName: string, panelId: string): void { this.packages.recordPackageUse(packageName, panelId); }
    public pendingPackageUpdates(): PackageUpdateWait[] { return this.packages.pendingPackageUpdates(); }
    public applyReadyStagedPackages(): Promise<void> { return this.packages.applyReadyStagedPackages(); }
    public downloadPackage(packageName: string, onProgress?: ProgressCallback, expectedSha256?: string, options: { allowDowngrade?: boolean } = {}): Promise<PackageInstallOutcome> {
        return this.packages.downloadPackage(packageName, onProgress, expectedSha256, options);
    }

    // ─── panels (enginePanels.ts) and their services ────────────────────

    public listPanels(): Promise<{ panels: PanelManifest[]; invalid: Array<{ id: string; error: string }> }> { return this.panels.listPanels(); }
    public installPanel(panelId: string, expected: ExpectedPanelRelease = {}, onProgress?: ProgressCallback): Promise<PanelManifest> {
        return this.panels.installPanel(panelId, expected, onProgress);
    }
    public updateInUse(...args: Parameters<PanelInstaller["updateInUse"]>): ReturnType<PanelInstaller["updateInUse"]> { return this.panels.updateInUse(...args); }
    public restartPanelService(panelId: string): Promise<boolean> { return this.panels.restartPanelService(panelId); }
    public uninstallPanel(panelId: string, options?: { deleteData?: boolean }): Promise<UninstallResult> { return this.panels.uninstallPanel(panelId, options); }
    public installedPanelVersion(panelId: string): string | null { return this.panels.installedPanelVersion(panelId); }
    public panelDataEntries(panelId: string): { files: string; config: string } { return this.panels.panelDataEntries(panelId); }
    public withPanelOperation<T>(panelId: string, fn: () => Promise<T>): Promise<T> { return this.panels.withPanelOperation(panelId, fn); }
    public withServicePaused<T>(panelId: string, fn: () => Promise<T>, rollback?: () => Promise<void>): Promise<T> {
        return this.panels.withServicePaused(panelId, fn, rollback);
    }
    public replacePanelData(panelId: string, staged: { filesDir: string; configFile: string | null }): Promise<void> {
        return this.panels.replacePanelData(panelId, staged);
    }
    public onPanelDataDeleted(listener: (panelId: string) => void | Promise<void>): () => void { return this.panels.onPanelDataDeleted(listener); }

    /** Panel service children that have not exited. */
    public runningServiceCount(): number { return this.services.runningCount(); }
    /** Each running panel service's process, by panel. */
    public serviceRoots(): Array<{ panelId: string; pid: number }> { return this.services.processRoots(); }
    /** asks the panel's running service to get ready for a backup of its
     * data, when it takes part; see PanelServicesManager.prepareForBackup */
    public prepareServiceForBackup(panelId: string, sourceId?: string): Promise<boolean> {
        return this.services.prepareForBackup(requirePanelId(panelId), sourceId);
    }
    public prepareServiceForRestore(panelId: string, sourceId?: string): Promise<boolean> {
        return this.services.prepareForBackup(requirePanelId(panelId), sourceId, 300_000, "restore");
    }
    /** tells the panel's running service how a backup or restore of its
     * data ended; see PanelServicesManager.tellBackupEnded */
    public tellServiceBackupEnded(panelId: string, operation: "backup" | "restore", ended: BackupEnded): void {
        this.services.tellBackupEnded(requirePanelId(panelId), operation, ended);
    }
}
