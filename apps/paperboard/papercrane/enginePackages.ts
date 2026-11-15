// Runtime packages (Java, Node, ...) under packages/: verified installs from
// the registry, which panels use which, and updates that wait beside the
// installed release until the workloads running from it have stopped
import path from "path";
import fs from "fs";
import { sanitizeId, writeJsonAtomicSync, LimitError } from "./storage";
import { ProgressCallback, streamToFileWithProgress } from "./download";
import { logger } from "./logger";
import { applyPackageRecipe, extractPackageArchive, findBinDir, packageArchiveSuffix, parsePackageLayout, RECIPE_SUFFIX } from "./engineArchives";
import { assertRecipeRunsHere, parsePackageRecipe, recipeDigest, type PackageRecipe } from "@mileniumhq/release";
import { requireReleaseOrder } from "./releasePolicy";
import { fetchRegistryRecord } from "./registryRecord";
import { hostPlatformKey } from "./packageChecksum";
import { releaseMessage, requireReleaseSignature } from "@mileniumhq/release";
import { recoverParked, swapParked } from "./parkedSwap";
import type { WorkloadRegistry, WorkloadRuntime, WorkloadUse } from "./engineWorkloads";
import { errorMessage } from "@mileniumhq/paperapi/errors";

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
    blockedBy: WorkloadUse[];
    error?: string;
}

// a package install either completed, or it is staged and waits
export interface PackageInstallOutcome {
    path: string;
    waiting?: PackageUpdateWait;
}

const MAX_STAGED_PACKAGES = 64;

// a registry release for this platform whose checksum, signature and
// version order have been checked
interface VerifiedPackageRelease {
    version: string;
    sha256: string;
    recipe: PackageRecipe | null;
    // the record's entry for this platform: url, sha1, layout
    download: { url: string; sha1?: string; layout?: unknown };
}

/** where releases come from and the key that must have signed them; shared
 * with the panel installer, fixed in production */
export interface ReleaseSource {
    url: string;
    key: string;
}

export function sanitizeIdOrThrow(id: string, what: string): string {
    const clean = sanitizeId(id);
    if (!clean) throw new Error(`Invalid ${what} id: ${id}`);
    return clean;
}

export class PackageManager implements WorkloadRuntime {
    private stagedPackages = new Map<string, StagedPackage>();
    private swapFailures = new Map<string, { version: string; error: string }>();
    private swaps = new Map<string, Promise<void>>();
    // packages whose directory is being renamed right now
    private swapping = new Set<string>();
    // the workloads, set once both exist (each needs the other)
    private workloads!: WorkloadRegistry;

    constructor(
        private packagesDir: string,
        private panelsDir: string,
        // the install locks every package and panel operation shares
        private operations: Set<string>,
        private registry: ReleaseSource,
    ) {
        this.loadStagedPackages();
    }

    public useWorkloads(workloads: WorkloadRegistry): void {
        this.workloads = workloads;
    }

    // ─── what a workload's life means for its runtime ───────────────────

    public async beforeStart(id: string, command: string): Promise<void> {
        // a staged update of this workload's runtime lands before it starts,
        // when nothing else still runs from the installed release
        const runtime = this.packageOfCommand(command);
        if (runtime) {
            await this.applyStagedPackage(runtime).catch((err) =>
                // recorded in swapFailures; the rolled-back release is intact
                logger.warn(`[engine] starting ${id} on the installed ${runtime}; its staged update failed:`, err),
            );
        }
        this.requireNotReplacing(command);
    }

    public requireNotReplacing(command: string): void {
        const runtime = this.packageOfCommand(command);
        if (runtime && this.swapping.has(runtime)) {
            throw new Error(`The shared runtime "${runtime}" is being replaced; wait for it to finish before starting workloads`);
        }
    }

    public ended(): void {
        if (this.stagedPackages.size > 0) void this.applyReadyStagedPackages();
    }

    /** Whether an update of the package is staged and waits. */
    public hasStaged(name: string): boolean {
        return this.stagedPackages.has(name);
    }

    // Startup only, by the daemon that owns the data dir: a swap a crash
    // interrupted is put back or finished, a staged directory without its
    // record is a staging that never completed, and the packages no panel
    // uses go
    public recoverAtStartup(): void {
        this.sweepPackageSwaps();
        this.claimUnrecordedPackages();
        void this.removeUnusedPackages();
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
                    !findBinDir(this.stagedDir(name), 4)
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

    // ─── which panels use which package ─────────────────────────────────
    //
    // A package stays while a panel uses it. A panel uses a package once it
    // asks for it (installs it, or asks whether it's there or where it is);
    // uninstalling the panel lets go of it, and a package no installed panel
    // uses is removed. Kept in packages/users.json as { package: [panelId] }.

    private packageUsersFile(): string {
        return path.join(this.packagesDir, "users.json");
    }

    private readPackageUsers(): Record<string, string[]> {
        const file = this.packageUsersFile();
        if (!fs.existsSync(file)) return {};
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} is not a record of package users`);
        return parsed as Record<string, string[]>;
    }

    private writePackageUsers(users: Record<string, string[]>): void {
        fs.mkdirSync(this.packagesDir, { recursive: true });
        writeJsonAtomicSync(this.packageUsersFile(), users);
    }

    /** Records that a panel uses a package, so it stays while the panel does. */
    public recordPackageUse(packageName: string, panelId: string): void {
        const name = sanitizeIdOrThrow(packageName, "package");
        const users = this.readPackageUsers();
        const list = users[name] ?? [];
        if (list.includes(panelId)) return;
        users[name] = [...list, panelId];
        this.writePackageUsers(users);
    }

    /** The packages installed now, by the directories under packages/. */
    private installedPackageNames(): string[] {
        if (!fs.existsSync(this.packagesDir)) return [];
        return fs
            .readdirSync(this.packagesDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !/\.(tmp|staging)-\d+/.test(entry.name))
            .map((entry) => entry.name);
    }

    // a package installed before uses were recorded may belong to any panel
    // installed now, so each of them counts as using it: it goes once all of
    // them are uninstalled. Only a package panels let go of is removed, so
    // one no panel ever asked for stays.
    private claimUnrecordedPackages(): void {
        try {
            const users = this.readPackageUsers();
            const unrecorded = this.installedPackageNames().filter((name) => !(name in users));
            if (!unrecorded.length) return;
            const panels = fs.existsSync(this.panelsDir)
                ? fs.readdirSync(this.panelsDir, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".")).map((e) => e.name)
                : [];
            if (!panels.length) return;
            for (const name of unrecorded) users[name] = [...panels];
            this.writePackageUsers(users);
        } catch (err) {
            logger.error("[engine] could not record which panels use the installed packages:", err);
        }
    }

    /**
     * Lets go of every package a panel used; the ones nothing uses any more
     * are removed. Resolves with what could not be removed, one line each.
     */
    public async releasePackagesOf(panelId: string): Promise<string[]> {
        const users = this.readPackageUsers();
        let changed = false;
        for (const [name, list] of Object.entries(users)) {
            if (!list.includes(panelId)) continue;
            users[name] = list.filter((id) => id !== panelId);
            changed = true;
        }
        if (changed) this.writePackageUsers(users);
        return this.removeUnusedPackages();
    }

    // a package a workload still runs from waits: its record stays empty, and
    // the next uninstall or start removes it. Resolves with each failure,
    // which is logged here too.
    private async removeUnusedPackages(): Promise<string[]> {
        const failures: string[] = [];
        let users: Record<string, string[]>;
        try {
            users = this.readPackageUsers();
        } catch (err) {
            logger.error("[engine] could not read which panels use the installed packages, so none were removed:", err);
            return [`which panels use them could not be read: ${errorMessage(err)}`];
        }
        for (const [name, list] of Object.entries(users)) {
            if (list.length > 0) continue;
            const key = `package:${name}`;
            if (this.operations.has(key) || this.packageUsers(name).length > 0) {
                logger.info(`[package:${name}] no panel uses it, but it's busy; it will be removed later`);
                continue;
            }
            this.operations.add(key);
            try {
                // a panel may have asked for it since the list was read
                if (this.readPackageUsers()[name]?.length) continue;
                await fs.promises.rm(path.join(this.packagesDir, name), { recursive: true, force: true });
                fs.rmSync(this.stagedRecordFile(name), { force: true });
                await fs.promises.rm(this.stagedDir(name), { recursive: true, force: true });
                this.stagedPackages.delete(name);
                this.swapFailures.delete(name);
                const index = this.getPackageIndex();
                if (name in index) {
                    delete index[name];
                    writeJsonAtomicSync(path.join(this.packagesDir, "index.json"), index);
                }
                const now = this.readPackageUsers();
                if (now[name]?.length === 0) {
                    delete now[name];
                    this.writePackageUsers(now);
                }
                logger.info(`[package:${name}] removed: no installed panel uses it`);
            } catch (err) {
                logger.error(`[package:${name}] no panel uses it, but it could not be removed:`, err);
                failures.push(`${name}: ${errorMessage(err)}`);
            } finally {
                this.operations.delete(key);
            }
        }
        return failures;
    }

    private sweepPackageSwaps(): void {
        recoverParked(this.packagesDir, "replaced");
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
                const staged = /^\.staged-(.+?)(\.json)?$/.exec(entry);
                if (staged && !this.stagedPackages.has(staged[1]!)) {
                    fs.rmSync(full, { recursive: true, force: true });
                }
            } catch (err) {
                logger.error(`[engine] could not recover ${entry} after an interrupted package update:`, err);
            }
        }
    }

    // Runtime package management
    public isPackageInstalled(packageName: string, version?: string): boolean {
        // validated like downloadPackage: a name is a directory under
        // packages/, never a path that climbs out of it
        packageName = sanitizeIdOrThrow(packageName, "package");
        const base = path.join(this.packagesDir, packageName);
        if (!fs.existsSync(base)) return false;
        if (findBinDir(base, 4) === null) return false;
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
        const base = path.join(this.packagesDir, sanitizeIdOrThrow(packageName, "package"));
        const found = findBinDir(base, 4);
        return found || base;
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
    public packageUsers(name: string): WorkloadUse[] {
        return this.workloads.users((command) => command === null || this.packageOfCommand(command) === name);
    }

    public packageUpdateWait(name: string): PackageUpdateWait | null {
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
            await swapParked([targetDir], "replaced", async () => {
                await fs.promises.rename(srcDir, targetDir);
                writeJsonAtomicSync(path.join(this.packagesDir, "index.json"), index);
            });
        } finally {
            this.swapping.delete(name);
        }
        this.swapFailures.delete(name);
    }

    // installs a staged release once no workload runs from the installed
    // one; concurrent callers share the swap in flight
    public async applyStagedPackage(name: string): Promise<void> {
        await this.workloads.adopted();
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
                const error = errorMessage(err);
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

    public async downloadPackage(
        packageName: string,
        onProgress?: ProgressCallback,
        expectedSha256?: string,
        options: { allowDowngrade?: boolean } = {},
    ): Promise<PackageInstallOutcome> {
        const key = `package:${sanitizeIdOrThrow(packageName, "package")}`;
        if (this.operations.has(key)) throw new Error(`An operation on ${packageName} is already running`);
        if (this.operations.size >= 8) throw new LimitError("Too many concurrent installs");
        this.operations.add(key);
        try { return await this.installPackageRelease(packageName, onProgress, expectedSha256, options); }
        finally { this.operations.delete(key); }
    }

    private async installPackageRelease(packageName: string, onProgress?: ProgressCallback, expectedSha256?: string, options: { allowDowngrade?: boolean } = {}): Promise<PackageInstallOutcome> {
        packageName = sanitizeIdOrThrow(packageName, "package");
        const release = await this.resolvePackageRelease(packageName, expectedSha256, options, onProgress);
        const targetDir = path.join(this.packagesDir, packageName);

        if (this.getPackageIndex()[packageName]?.sha256 === release.sha256 && findBinDir(targetDir, 4)) {
            onProgress?.({ stage: "completed", percent: 100, message: "Requested release is installed" });
            return { path: targetDir };
        }
        // already downloaded and verified, still waiting on its workloads:
        // swap it now if they are gone, never download the same bytes again
        if (this.stagedPackages.get(packageName)?.sha256 === release.sha256) {
            await this.applyStagedPackage(packageName);
            const waiting = this.packageUpdateWait(packageName);
            onProgress?.({ stage: "completed", percent: 100, message: waiting ? "Update waits for running workloads" : "Installed successfully" });
            return waiting ? { path: targetDir, waiting } : { path: targetDir };
        }
        // refused before any download: a layout this daemon does not know
        // would install binaries where no caller looks for them
        const layout = parsePackageLayout(release.download.layout);
        if (release.recipe) assertRecipeRunsHere(release.recipe);
        // keep the URL extension so extraction dispatches on format
        const urlExt = release.recipe ? RECIPE_SUFFIX[release.recipe.unpack] : packageArchiveSuffix(release.download.url);
        const tempArchive = path.join(this.packagesDir, `${packageName}-archive.tmp-${Date.now()}${urlExt}`);
        const pkgDir = `${targetDir}.staging-${Date.now()}`;
        const log = (msg: string) => logger.info(`[package:${packageName}] ${msg}`);
        try {
            await this.downloadRelease(release, tempArchive, log, onProgress);
            onProgress?.({ stage: "extracting", percent: 50, message: "Extracting package..." });
            fs.mkdirSync(pkgDir, { recursive: true });
            if (release.recipe) await applyPackageRecipe(tempArchive, pkgDir, release.recipe);
            else await extractPackageArchive(tempArchive, pkgDir, layout, urlExt);
            const binPresent = findBinDir(pkgDir, 4) !== null;
            log(`extraction complete; bin present: ${binPresent}`);
            // require bin/ before indexing, else remove and fail
            if (!binPresent) {
                await fs.promises.rm(pkgDir, { recursive: true, force: true });
                throw new Error(`Package ${packageName} extracted but no usable binary directory was found. Removed partial install.`);
            }
            return await this.placeRelease({ name: packageName, version: release.version, sha256: release.sha256 }, pkgDir, targetDir, log, onProgress);
        } catch (err: any) {
            log(`FAILED: ${err?.message || err}`);
            // every success path moves pkgDir away, so a copy still here is a leftover
            if (fs.existsSync(pkgDir)) {
                await fs.promises.rm(pkgDir, { recursive: true, force: true }).then(
                    () => log("removed partial install"),
                    (err) => logger.warn(`[engine] the partial install ${pkgDir} was left on disk:`, err),
                );
            }
            throw err;
        } finally {
            if (fs.existsSync(tempArchive)) {
                await fs.promises.unlink(tempArchive).catch((err) => logger.warn(`[engine] the download ${tempArchive} was left on disk:`, err));
            }
        }
    }

    // The registry record of this platform's release, checked against the
    // caller's checksum fact, the release key and the installed release's
    // version. Nothing is downloaded before every check holds.
    private async resolvePackageRelease(
        packageName: string,
        expectedSha256: string | undefined,
        options: { allowDowngrade?: boolean },
        onProgress?: ProgressCallback,
    ): Promise<VerifiedPackageRelease> {
        // trust boundary: same rule as installPanel — no checksum fact from
        // the anchor means no install, never proceed with sha256: undefined
        if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
            throw new Error(`Install refused for package "${packageName}": registry did not provide a sha256 checksum`);
        }
        const platformKey = hostPlatformKey();
        const metaUrl = `${this.registry.url}/package/${encodeURIComponent(packageName)}.json`;
        logger.info(`[package:${packageName}] resolving ${metaUrl}`);
        onProgress?.({ stage: "checking", percent: 0, message: `Resolving package ${packageName}...` });
        let meta: any;
        try {
            meta = await fetchRegistryRecord(metaUrl);
        } catch (err) {
            throw new Error(`Install refused for package "${packageName}": registry record unavailable (${errorMessage(err)})`);
        }
        // only the platforms map is a release record: the signature covers
        // (name, version, platform, sha256) of exactly that entry
        const download = meta?.platforms?.[platformKey];
        if (!download?.url) throw new Error(`No download available for ${packageName} on ${platformKey}`);
        if (typeof meta.version !== "string" || !meta.version) {
            throw new Error(`Install refused for package "${packageName}": registry did not provide a version`);
        }
        logger.info(`[package:${packageName}] source: ${download.url}`);
        // the caller's checksum fact must agree with the record; a mismatch
        // (or a record without one) means one of the two sources is lying
        if (typeof download.sha256 !== "string" || download.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
            throw new Error(`Install refused for package "${packageName}": checksum mismatch between update plan and registry metadata`);
        }
        // a recipe is part of what is signed: parse it before verifying
        const recipe = download.recipe === undefined ? null : parsePackageRecipe(download.recipe);
        if (recipe && download.layout !== undefined) {
            throw new Error(`Install refused for package "${packageName}": a recipe entry cannot also declare a layout`);
        }
        requireReleaseSignature(
            releaseMessage.package(packageName, meta.version, platformKey, download.sha256, recipe ? recipeDigest(recipe) : undefined),
            download.signature,
            `package "${packageName}"`,
            this.registry.key,
        );
        requireReleaseOrder(
            { version: meta.version, sha256: expectedSha256 },
            [this.getPackageIndex()[packageName], this.stagedPackages.get(packageName)],
            options,
        );
        return { version: meta.version, sha256: expectedSha256, recipe, download };
    }

    // the verified archive, with a log line every 10%
    private async downloadRelease(release: VerifiedPackageRelease, tempArchive: string, log: (msg: string) => void, onProgress?: ProgressCallback): Promise<void> {
        log("downloading...");
        let lastMilestone = 0;
        const milestoneProgress: ProgressCallback = (payload) => {
            if (payload.stage === "downloading" && payload.bytesTotal && payload.percent - lastMilestone >= 10) {
                lastMilestone = Math.floor(payload.percent / 10) * 10;
                log(`${lastMilestone}% (${Math.round(payload.bytesLoaded! / 1048576)} MB) of ${Math.round(payload.bytesTotal / 1048576)} MB`);
            }
            onProgress?.(payload);
        };
        await streamToFileWithProgress(release.download.url, tempArchive, milestoneProgress, release.download.sha1, release.sha256);
        log(`download finished (${fs.statSync(tempArchive).size} bytes)`);
    }

    // Runtimes are shared host resources: a workload running from the
    // installed release keeps it. The verified release is staged beside it
    // and swapped in once the last of them exits.
    private async placeRelease(release: StagedPackage, pkgDir: string, targetDir: string, log: (msg: string) => void, onProgress?: ProgressCallback): Promise<PackageInstallOutcome> {
        if (fs.existsSync(targetDir) && this.packageUsers(release.name).length > 0) {
            await this.stagePackage(release, pkgDir);
            const waiting = this.packageUpdateWait(release.name)!;
            log(`staged ${release.version}; waiting for ${waiting.blockedBy.length} workload(s) to stop`);
            onProgress?.({ stage: "completed", percent: 100, message: "Update waits for running workloads" });
            return { path: targetDir, waiting };
        }
        await this.swapPackage(release, pkgDir);
        onProgress?.({ stage: "completed", percent: 100, message: "Installed successfully" });
        return { path: targetDir };
    }
}
