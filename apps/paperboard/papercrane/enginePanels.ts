// Installed panels under panels/: listing them, verified installs and
// updates from the registry, uninstalling, and swapping a panel's data in
// for a restore, each holding the panel's operation lock
import path from "path";
import fs from "fs";
import { PanelManifest } from "./types";
import { moveFileSafe, panelFilesDirName, LimitError } from "./storage";
import { validatePanelManifest } from "./panelManifest";
import { ProgressCallback, streamToFileWithProgress } from "./download";
import { logger } from "./logger";
import { extractArchive } from "./engineArchives";
import type { PanelServicesManager } from "./panelServices";
import type { CredentialStore } from "./credentials";
import { RpcError } from "./rpc/errors";
import { ErrorCode } from "./protocol";
import { requireReleaseOrder } from "./releasePolicy";
import { requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import { fetchRegistryRecord } from "./registryRecord";
import { releaseMessage, requireReleaseSignature } from "./releaseSignature";
import { recoverParked, rollbackFailed, swapParked } from "./parkedSwap";
import type { WorkloadRegistry } from "./engineWorkloads";
import { sanitizeIdOrThrow, type PackageManager, type ReleaseSource } from "./enginePackages";

// what a caller expects to install (the release it showed the user or
// planned an update to); the daemon's own registry lookup must agree
export interface ExpectedPanelRelease {
    allowDowngrade?: boolean;
    version?: string;
    sha256?: string;
}

/**
 * What an uninstall did. It resolves only once the panel is gone; the panel
 * RPC (panel:uninstall) replies with these fields beside `success`.
 */
export interface UninstallResult {
    /**
     * Set when the panel is uninstalled but packages only it used could not
     * be removed (they stay on disk). The user must be shown it: it names the
     * panel and each package with its reason.
     */
    packagesWarning?: string;
}

// a process stopped for an update gets this long to exit on its terminate
// signal (a game server saving its world) before it is killed
const UPDATE_STOP_GRACE_MS = 30_000;

export interface PanelDirs {
    appDataDir: string;
    panelsDir: string;
    filesDir: string;
    configsDir: string;
}

export class PanelInstaller {
    private appDataDir: string;
    private panelsDir: string;
    private filesDir: string;
    private configsDir: string;
    private readonly dataDeletedListeners = new Set<(panelId: string) => void | Promise<void>>();

    constructor(
        dirs: PanelDirs,
        // the install locks every package and panel operation shares
        private operations: Set<string>,
        private services: PanelServicesManager,
        private workloads: WorkloadRegistry,
        private packages: PackageManager,
        private credentialsStore: CredentialStore,
        private registry: ReleaseSource,
    ) {
        this.appDataDir = dirs.appDataDir;
        this.panelsDir = dirs.panelsDir;
        this.filesDir = dirs.filesDir;
        this.configsDir = dirs.configsDir;
    }

    // Startup only, by the daemon that owns the data dir: a panel release or
    // restore a crash interrupted is put back, or its leftover removed
    public recoverAtStartup(): void {
        recoverParked(this.panelsDir, "replaced");
        recoverParked(this.filesDir, "restore-parked");
        recoverParked(this.configsDir, "restore-parked");
    }

    // a panel's operation lock: install, restart, uninstall, backup and
    // restore exclude each other; installs also count against the limit
    private async locked<T>(cleanId: string, fn: () => Promise<T>, limit = false): Promise<T> {
        const key = `panel:${cleanId}`;
        if (this.operations.has(key)) throw new RpcError(ErrorCode.CONFLICT, `An operation on ${cleanId} is already running`);
        if (limit && this.operations.size >= 8) throw new LimitError("Too many concurrent installs");
        this.operations.add(key);
        try {
            return await fn();
        } finally {
            this.operations.delete(key);
        }
    }

    // a panel's config document, configs/<id>.json
    private configName(cleanId: string): string {
        return `${sanitizeIdOrThrow(cleanId, "config")}.json`;
    }

    // Manifest hunt: root manifest.json, else one level of subdirectories
    private findManifestFile(dir: string): string | null {
        const root = path.join(dir, "manifest.json");
        if (fs.existsSync(root)) return root;
        if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return null;
        for (const sub of fs.readdirSync(dir)) {
            const candidate = path.join(dir, sub, "manifest.json");
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    // Installed panels, and the ones whose manifest can't be read or is
    // invalid: those are named with the reason instead of vanishing, so the
    // shell can say why a panel is missing and still offer to remove it.
    public async listPanels(): Promise<{ panels: PanelManifest[]; invalid: Array<{ id: string; error: string }> }> {
        const panels: PanelManifest[] = [];
        const invalid: Array<{ id: string; error: string }> = [];
        if (!fs.existsSync(this.panelsDir)) return { panels, invalid };
        for (const entry of await fs.promises.readdir(this.panelsDir)) {
            if (entry.startsWith(".")) continue;
            const panelPath = path.join(this.panelsDir, entry);
            try {
                // a stray file beside the panel folders is not a panel
                if (!fs.statSync(panelPath).isDirectory()) continue;
                const manifestPath = this.findManifestFile(panelPath);
                if (!manifestPath) throw new Error("it has no manifest.json");
                const validated = validatePanelManifest(JSON.parse(await fs.promises.readFile(manifestPath, "utf-8")), entry);
                const isDevLink = fs.lstatSync(panelPath).isSymbolicLink();
                const serviceError = this.services.failure(entry);
                panels.push({
                    ...validated,
                    base: validated.base || "./dist/index.html",
                    isInstalled: true,
                    isDevLink,
                    isLinked: isDevLink,
                    ...(isDevLink ? { installSource: "dev" as const } : {}),
                    ...(serviceError ? { serviceError } : {}),
                } as PanelManifest);
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                logger.error(`[Paperboard Server] panel ${entry} is not listed: its manifest is unreadable or invalid: ${error}`);
                invalid.push({ id: entry, error });
            }
        }
        return { panels, invalid };
    }

    // Installs the registry's current release of a panel. The daemon asks
    // its own registry which release that is and which bytes are right, and
    // downloads only from the registry: a caller names the panel and may
    // state what it expects, never where the bytes come from.
    public async installPanel(
        panelId: string,
        expected: ExpectedPanelRelease = {},
        onProgress?: ProgressCallback,
    ): Promise<PanelManifest> {
        const cleanId = requirePanelId(panelId);
        return this.locked(cleanId, () => this.installPanelRelease(cleanId, expected, onProgress), true);
    }

    /**
     * Stop and update: the workloads the given updates wait for stop once
     * (each owning panel's beforeUpdate first), every staged package swaps
     * in and every panel release installs, and each owner hears the update
     * end once (afterUpdate) so it starts them again. A target that fails
     * does not stop the others: resolves with the panels installed and why
     * each failed target failed, by target ("panel:<id>", "package:<name>").
     */
    public async updateInUse(
        targets: { panels?: Array<{ id: string; expected?: ExpectedPanelRelease }>; packages?: string[] },
        onProgress?: (target: string, payload: Parameters<ProgressCallback>[0]) => void,
    ): Promise<{ installed: PanelManifest[]; failures: Record<string, string> }> {
        const panels = (targets.panels ?? []).map((p) => ({ id: requirePanelId(p.id), expected: p.expected ?? {} }));
        const packages = (targets.packages ?? []).map((name) => sanitizeIdOrThrow(name, "package"));
        if (panels.length === 0 && packages.length === 0) throw new Error("Nothing to update");
        for (const name of packages) {
            if (!this.packages.hasStaged(name)) throw new Error(`No update of ${name} is waiting`);
        }
        const processes = [...new Set([
            ...panels.flatMap((p) => this.workloads.panelWorkloads(p.id)),
            ...packages.flatMap((name) => this.packages.packageUsers(name).map((u) => u.processId)),
        ])];
        const owners = new Map<string, string[]>();
        for (const id of processes) {
            const owner = this.workloads.clientOwner(id);
            if (owner) owners.set(owner, [...(owners.get(owner) ?? []), id]);
        }
        const all = [...panels.map((p) => `panel:${p.id}`), ...packages.map((n) => `package:${n}`)];
        for (const target of all) onProgress?.(target, { stage: "stopping", percent: 0, message: "Stopping processes" });
        await this.stopWorkloadsForUpdate(processes);
        const failures: Record<string, string> = {};
        const installed: PanelManifest[] = [];
        for (const name of packages) {
            const target = `package:${name}`;
            try {
                onProgress?.(target, { stage: "extracting", percent: 50, message: "Installing" });
                await this.packages.applyStagedPackage(name);
                const left = this.packages.packageUpdateWait(name);
                if (left?.error) throw new Error(left.error);
                if (left) throw new Error(`${name} is still in use by ${left.blockedBy.length} process(es) that started during the update`);
                onProgress?.(target, { stage: "completed", percent: 100, message: "Installed successfully" });
            } catch (err) {
                failures[target] = err instanceof Error ? err.message : String(err);
            }
        }
        for (const panel of panels) {
            const target = `panel:${panel.id}`;
            try {
                installed.push(await this.installPanel(panel.id, panel.expected, (payload) => onProgress?.(target, payload)));
            } catch (err) {
                failures[target] = err instanceof Error ? err.message : String(err);
            }
        }
        const failed = Object.entries(failures);
        const error = failed.length ? failed.map(([target, why]) => `${target.slice(target.indexOf(":") + 1)}: ${why}`).join("; ") : undefined;
        for (const [owner, ids] of owners) {
            this.services.tellUpdateEnded(owner, { processes: ids, ok: !error, ...(error ? { error } : {}) });
        }
        return { installed, failures };
    }

    // each owning panel's service stops its own first; whatever is still
    // running then gets a terminate signal and time to exit cleanly
    private async stopWorkloadsForUpdate(processes: string[]): Promise<void> {
        const byOwner = new Map<string, string[]>();
        for (const id of processes) {
            const owner = this.workloads.clientOwner(id);
            if (owner) byOwner.set(owner, [...(byOwner.get(owner) ?? []), id]);
        }
        for (const [owner, ids] of byOwner) {
            try {
                await this.services.prepareForUpdate(owner, ids);
            } catch (err) {
                throw new Error(`${owner} could not stop its processes for the update: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
            }
        }
        for (const id of processes) {
            await this.workloads.stop(id, "SIGTERM", UPDATE_STOP_GRACE_MS);
        }
    }

    // the registry record is the authority for the release; any caller
    // expectation that disagrees with it refuses the install
    private async resolvePanelRelease(id: string, expected: ExpectedPanelRelease): Promise<{ version: string; sha256: string }> {
        let raw: any;
        try {
            raw = await fetchRegistryRecord(`${this.registry.url}/panel/${encodeURIComponent(id)}.json`);
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
        requireReleaseSignature(releaseMessage.panel(id, raw.version, sha256), raw.signature, `"${id}"`, this.registry.key);
        if (expected.sha256 !== undefined && expected.sha256.toLowerCase() !== sha256) {
            throw new Error(`Install refused for "${id}": the registry now lists different bytes than the release requested`);
        }
        if (expected.version !== undefined && expected.version !== raw.version) {
            throw new Error(`Install refused for "${id}": requested version ${expected.version}, the registry lists ${raw.version}`);
        }
        return { version: raw.version, sha256 };
    }

    private async installPanelRelease(cleanId: string, expected: ExpectedPanelRelease, onProgress?: ProgressCallback): Promise<PanelManifest> {
        const release = await this.resolvePanelRelease(cleanId, expected);
        const downloadUrl = `${this.registry.url}/panel/${encodeURIComponent(cleanId)}/download`;
        const targetDir = path.join(this.panelsDir, cleanId);

        if (fs.lstatSync(targetDir, { throwIfNoEntry: false })?.isSymbolicLink()) {
            throw new Error(`Panel "${cleanId}" is currently symlinked for development. Remove the dev link before installing from registry.`);
        }
        if (fs.existsSync(targetDir)) {
            const version = this.installedPanelVersion(cleanId);
            if (!version) throw new Error(`Install refused for "${cleanId}": installed manifest has no version`);
            requireReleaseOrder(release, [{ version }], expected);
        }
        const stagingDir = `${targetDir}.staging-${Date.now()}`;
        const tempArchive = path.join(
            this.panelsDir,
            `${cleanId}.tmp-${Date.now()}.tar.gz`,
        );

        try {
            onProgress?.({ stage: "downloading", percent: 0, message: "Downloading" });
            await streamToFileWithProgress(
                downloadUrl,
                tempArchive,
                onProgress,
                undefined,
                release.sha256,
            );
            onProgress?.({ stage: "extracting", percent: 100, message: "Installing" });

            if (fs.existsSync(stagingDir)) {
                await fs.promises.rm(stagingDir, {
                    recursive: true,
                    force: true,
                });
            }
            fs.mkdirSync(stagingDir, { recursive: true });
            await extractArchive(tempArchive, stagingDir);

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
            await this.workloads.stopPanelWorkloads(cleanId);

            // the live release is parked only until the new one is ready. A
            // failed activation removes the new release and starts the
            // previous one again in place; a successful one leaves no copy.
            const hadPrevious = fs.existsSync(targetDir);
            await swapParked([targetDir], "replaced", async () => {
                await moveFileSafe(contentDir, targetDir);
                await this.services.startAndWait(cleanId);
            }, {
                before: () => this.services.stopService(cleanId),
                after: async () => { if (hadPrevious) await this.services.startAndWait(cleanId); },
            });
            await fs.promises
                .rm(stagingDir, { recursive: true, force: true })
                .catch((err) => logger.warn(`[engine] the staging copy ${stagingDir} was left on disk:`, err));

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
                .catch((cleanupErr) => logger.warn(`[engine] the staging copy ${stagingDir} was left on disk:`, cleanupErr));
            throw err;
        } finally {
            if (fs.existsSync(tempArchive))
                await fs.promises.unlink(tempArchive).catch((err) => logger.warn(`[engine] the download ${tempArchive} was left on disk:`, err));
        }
    }

    /** Restarts only the panel's service child. Workloads it started through
     * process:run/terminals are daemon-owned clients and keep running.
     * Resolves true once the new generation reports ready, false when the
     * panel declares no service. */
    public async restartPanelService(panelId: string): Promise<boolean> {
        const cleanId = requirePanelId(panelId);
        return this.locked(cleanId, async () => {
            if (!fs.existsSync(path.join(this.panelsDir, cleanId))) throw new Error(`Panel ${cleanId} is not installed`);
            await this.services.stopService(cleanId);
            return this.services.startAndWait(cleanId);
        });
    }

    // ─── Panel data, for backups ─────────────────────────────────────────

    /** a panel's backed-up data, relative to the data dir: its file storage
     * and its config document. Vault secrets are not panel data here. */
    public panelDataEntries(panelId: string): { files: string; config: string } {
        const cleanId = requirePanelId(panelId);
        return {
            files: path.posix.join("files", panelFilesDirName(cleanId)),
            config: path.posix.join("configs", this.configName(cleanId)),
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
        return this.locked(requirePanelId(panelId), fn);
    }

    /** runs `listener` when an uninstall deletes a panel's data; returns the
     * unsubscribe, which the subscriber calls when it is disposed */
    public onPanelDataDeleted(listener: (panelId: string) => void | Promise<void>): () => void {
        this.dataDeletedListeners.add(listener);
        return () => this.dataDeletedListeners.delete(listener);
    }

    /** runs fn (a backup copying the panel's data) with the panel's service
     * stopped, so the copy is not taken mid-write, then starts the service
     * again if it was running and waits for it to be ready. An optional
     * rollback runs while stopped if the work or its restart fails, then the
     * original service is restarted. A service that does not come back
     * fails the call. Call inside withPanelOperation. */
    public async withServicePaused<T>(panelId: string, fn: () => Promise<T>, rollback?: () => Promise<void>): Promise<T> {
        const cleanId = requirePanelId(panelId);
        const restart = this.restarter(cleanId);
        if (this.services.isActive(cleanId)) await this.services.stopService(cleanId);
        if (!rollback) {
            try {
                return await fn();
            } finally {
                await restart();
            }
        }
        try {
            const result = await fn();
            await restart();
            return result;
        } catch (err) {
            try {
                await this.services.stopService(cleanId);
                await rollback();
                await restart();
            } catch (rollbackErr) {
                throw rollbackFailed(err, rollbackErr);
            }
            throw err;
        }
    }

    // starts the panel's service again and waits for it, when it was meant
    // to run at the time this was made; nothing when it was not
    private restarter(cleanId: string): () => Promise<void> {
        const wasActive = this.services.isActive(cleanId);
        return async () => {
            if (wasActive) await this.services.startAndWait(cleanId);
        };
    }

    /**
     * Replaces a panel's file storage and config document with staged
     * copies (a restore). The service and the processes the panel owns are
     * stopped and observed exiting first. The live data is parked only
     * until the panel is ready on the new data (a service that was not
     * running stays stopped): a failure puts the parked data back in place
     * and restarts the panel on it. Call inside withPanelOperation.
     */
    public async replacePanelData(panelId: string, staged: { filesDir: string; configFile: string | null }): Promise<void> {
        const cleanId = requirePanelId(panelId);
        if (!fs.existsSync(path.join(this.panelsDir, cleanId))) throw new Error(`Panel ${cleanId} is not installed`);
        const entries = this.panelDataEntries(cleanId);
        const liveFiles = path.join(this.appDataDir, entries.files);
        const liveConfig = path.join(this.appDataDir, entries.config);
        const restart = this.restarter(cleanId);
        try {
            await this.services.stopService(cleanId);
            await this.workloads.stopPanelWorkloads(cleanId);
        } catch (err) {
            // nothing moved: the panel runs on its data again
            await restart().catch((restartErr) => { throw rollbackFailed(err, restartErr); });
            throw err;
        }
        await swapParked([liveFiles, liveConfig], "restore-parked", async () => {
            await moveFileSafe(staged.filesDir, liveFiles);
            if (staged.configFile) await moveFileSafe(staged.configFile, liveConfig);
            await restart();
        }, { before: () => this.services.stopService(cleanId), after: restart });
    }

    public async uninstallPanel(panelId: string, options?: { deleteData?: boolean }): Promise<UninstallResult> {
        const cleanId = requirePanelId(panelId);
        return this.locked(cleanId, async () => {
            await this.services.stopService(cleanId);
            // Resource identity comes from the ownership ledger. Legacy IDs
            // require an explicit migration; a name is not proof of ownership.
            await this.workloads.stopPanelWorkloads(cleanId);

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
            // the packages only this panel used go with it; the panel is gone
            // either way, so a failure here is the result's warning, not the
            // uninstall's failure
            const failures = await this.packages.releasePackagesOf(cleanId).catch((err: Error) => [err?.message ?? String(err)]);
            const result: UninstallResult = {};
            if (failures.length > 0) {
                result.packagesWarning = `${cleanId} is uninstalled, but the packages only it used could not be removed (${failures.join("; ")})`;
                logger.error(`[engine] ${result.packagesWarning}`);
            }

            if (options?.deleteData === true) {
                // explicit opt-in: the panel's config document, workspace files
                // and vault entries are deleted with the code
                await fs.promises.rm(path.join(this.configsDir, this.configName(cleanId)), { force: true });
                await fs.promises.rm(path.join(this.filesDir, panelFilesDirName(cleanId)), { recursive: true, force: true });
                this.credentialsStore.purge(cleanId);
                // what other owners keep about the panel (its routine backups)
                // goes with its data; their failure is the uninstall's failure
                for (const listener of [...this.dataDeletedListeners]) {
                    await listener(cleanId);
                }
            }
            return result;
        });
    }
}
