import * as path from "path";
import { app, BrowserWindow } from "electron";
import { AppUpdateSession, getAppUpdateState, retainAppUpdateState } from "./appUpdateSession";
import { ManualAppUpdater } from "./manualAppUpdater";
import { DOWNLOAD_BASE, linuxPackageInstall } from "./linuxPackageInstall";
import { LinuxPackageUpdater, onPath } from "./linuxPackageUpdater";
import { isShellUrl } from "./communication/shellGuard";
import type { AppUpdater } from "electron-updater";
import { createPlatformUpdater } from "./platformUpdater";
import { electronDataDir } from "./electronData";
import { is } from "@electron-toolkit/utils";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { resolveRegistryUrl, withTimeout } from "../../papercrane/util";
import { validSha256 } from "./updatePlan";
import { planUpdateTasks, withInstalledRecords } from "./updatePlan";
export type { UpdateTask, UpdateTaskType } from "./updatePlan";
import { readStateFileSync, writeFileAtomicSync } from "../../papercrane/storage";
import { getLocalDir } from "../../papercrane/paths";
import { logger, getLogger } from "../../papercrane/logger";
import { fetchRegistryJson } from "../../../../packages/paperapi/src/config";
import { PACKAGE_DOWNLOAD_TIMEOUT_MS } from "./communication/papercrane/PaperCraneClient";
import { collectPackageUpdates } from "./packageUpdates";
import { PartialUpdateError, UpdateQueue, type UpdateJob } from "./updateQueue";
import type { UpdateHold, UpdateItem, UpdateQueueState } from "../shared/updateQueue";
import type { AppUpdateState } from "../shared/appUpdate";
import type { UpdateTask } from "./updatePlan";

// registry override policy shared with the daemon: env override honored only
// outside production (dev/preview here) or with --allow-registry-override
const REGISTRY_URL = resolveRegistryUrl({
    nodeEnv: is.dev ? "development" : "production",
    env: process.env,
    argv: process.argv,
});
const UPDATE_COOLDOWN_MS = 30 * 60 * 1000;
const PING_TIMEOUT_MS = 5_000;
const TASK_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const FAILURE_COOLDOWN_RUNS = 2;
const TIMESTAMP_FILE = path.join(getLocalDir(), "last_update.json");

// how often a running Paperboard looks for updates again, and how often it
// looks at what holds updates back while any are held
const RECHECK_MS = 6 * 60 * 60_000;
const HOLD_REFRESH_MS = 30_000;

function broadcastQueue(state: UpdateQueueState): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && isShellUrl(window.webContents.getURL())) {
            window.webContents.send("update-queue", state);
        }
    }
}

export const updateQueue = new UpdateQueue(broadcastQueue);

interface UpdateState {
    lastUpdate?: number;
    consecutiveFailures?: number;
}

export function shouldSkipUpdate(argv: string[]): boolean {
    if (argv.includes("--skip-update")) return true;
    if (argv.includes("--update")) return false;
    let state: UpdateState;
    try {
        state = readUpdateState();
    } catch (err) {
        // an unreadable state file is not "no cooldown": don't run the
        // updater on bookkeeping we cannot trust, and say so loudly
        logger.warn("[Updater] update state unreadable; skipping this run:", err);
        return true;
    }
    const { lastUpdate } = state;
    return Boolean(
        lastUpdate && Date.now() - lastUpdate < UPDATE_COOLDOWN_MS,
    );
}

function readUpdateState(): UpdateState {
    // daemon-owned state: corrupt bytes are quarantined beside the file (not
    // silently ignored) and an unreadable file throws, so cooldown and
    // consecutive-failure bookkeeping cannot vanish without a trace
    return readStateFileSync<UpdateState>(TIMESTAMP_FILE, {}, "last_update.json");
}

function writeUpdateState(state: UpdateState) {
    // a failed write must surface: silently losing the cooldown/failure
    // bookkeeping would make shouldSkipUpdate lie
    writeFileAtomicSync(TIMESTAMP_FILE, JSON.stringify(state));
}

// clean run resets failure streak and arms cooldown
function saveCleanRun() {
    writeUpdateState({ lastUpdate: Date.now(), consecutiveFailures: 0 });
}

// arm cooldown only after repeated failing runs
function recordRunOutcome(failures: number) {
    const state = readUpdateState();
    if (failures === 0) {
        saveCleanRun();
        return;
    }
    const streak = (state.consecutiveFailures ?? 0) + 1;
    const armed = streak >= FAILURE_COOLDOWN_RUNS;
    writeUpdateState({
        lastUpdate: armed ? Date.now() : state.lastUpdate,
        consecutiveFailures: streak,
    });
}

async function fetchIndex(
    url: string,
): Promise<Record<string, any>> {
    try {
        return await fetchRegistryJson(url, FETCH_TIMEOUT_MS);
    } catch (err: any) {
        const aborted =
            err?.name === "TimeoutError" || err?.name === "AbortError";
        logger.warn(
            `[Updater] registry index fetch failed (${url}):`,
            aborted
                ? `aborted after ${FETCH_TIMEOUT_MS}ms timeout`
                : err?.message ?? err,
        );
        throw err;
    }
}

// guard overlapping runs so a stalled run can't double-install
let orchestratorRunning = false;

// polls system:info until the respawned daemon reports the target version.
// system:update only initiates the swap; the version fact is recorded only
// on this confirmation, never optimistically.
async function confirmCraneVersion(
    client: { getSystemInfo(): Promise<{ version?: string } | null> },
    computerId: string,
    version: string,
    timeoutMs = 90_000,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const info = await client.getSystemInfo().catch(() => null);
        if (info?.version === version) return true;
        if (Date.now() >= deadline) {
            logger.warn(
                `[Updater] Paperboard Server on ${computerId} never reported version ${version} after update`,
            );
            return false;
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
}

/**
 * Looks for updates of Paperboard, its panels, runtime packages and paired
 * computers' Paperboard Server, and runs them in the update queue. A panel
 * or package in use is held, not stopped. Resolves once the queue has run
 * every update it found.
 */
export async function runUpdateOrchestrator(): Promise<void> {
    if (orchestratorRunning) {
        logger.debug("[Updater] orchestrator already running, skipping");
        return;
    }
    orchestratorRunning = true;
    let failures = 0;
    let appRun: Promise<AppUpdateState> | null = null;
    updateQueue.setChecking(true);
    try {
        appRun = appUpdater().check();
        failures = await runOrchestratorInner();
    } catch (err) {
        failures++;
        logger.error("[Updater] update check failed:", err);
        updateQueue.setChecking(false, `Paperboard could not check for updates: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        try {
            const state = appRun ? await appRun : getAppUpdateState();
            if (state.status === "failed") failures++;
            recordRunOutcome(failures);
        } finally {
            orchestratorRunning = false;
            // staged runtime updates may now wait for panels to stop
            await refreshHolds();
        }
    }
}

let recheckTimer: ReturnType<typeof setInterval> | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts the background updater: a look for updates now (unless one ran
 * recently), and again every few hours while Paperboard runs.
 */
export function startBackgroundUpdates(argv: string[]): void {
    if (recheckTimer) return;
    if (!shouldSkipUpdate(argv)) void runUpdateOrchestrator().catch((err) => logger.error("[Updater] Orchestrator error:", err));
    else void refreshHolds();
    recheckTimer = setInterval(() => {
        void runUpdateOrchestrator().catch((err) => logger.error("[Updater] Orchestrator error:", err));
    }, RECHECK_MS);
    recheckTimer.unref?.();
}

export function stopBackgroundUpdates(): void {
    if (recheckTimer) clearInterval(recheckTimer);
    if (holdTimer) clearTimeout(holdTimer);
    recheckTimer = null;
    holdTimer = null;
}

/** Looks for updates now, whatever the cooldown says (Settings, Update everything now). */
export async function checkForUpdatesNow(): Promise<void> {
    await runUpdateOrchestrator();
}

// a panel held by its processes: what to install once they are gone
const heldPanelTasks = new Map<string, UpdateTask>();

/**
 * Reads what holds updates back again: staged packages from each computer's
 * daemon, and held panels whose processes may have stopped (their update
 * then runs). While anything is held it looks again every so often.
 */
export async function refreshHolds(): Promise<void> {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    try {
        const packages = await collectPackageUpdates();
        const holds: UpdateHold[] = [];
        const unheld: UpdateHold[] = [];
        for (const notice of packages.notices) {
            const key = `package:${notice.computerId}:${notice.packageName}`;
            if (notice.error) {
                // the swap failed and the installed release kept working
                updateQueue.report(failedItem(key, "package", notice.computerId, notice.computerId === "local" ? null : notice.computerName, notice.packageName, notice.version, notice.error));
                continue;
            }
            const hold: UpdateHold = {
                key,
                kind: "package",
                computerId: notice.computerId,
                computerName: notice.computerId === "local" ? null : notice.computerName,
                id: notice.packageName,
                name: notice.packageName,
                version: notice.version,
                sha256: null,
                users: notice.panels,
            };
            // nothing important or long running uses it: it updates now,
            // unless doing that already failed (then it waits to be asked)
            if (notice.panels.length === 0 && !stopFailed.has(`${key}\u0000${notice.version}`)) unheld.push(hold);
            else holds.push(hold);
        }
        updateQueue.setHolds("packages", holds);
        for (const hold of unheld) {
            void updateQueue.enqueue(inUseJob([hold])).then(([item]) => {
                if (item.status === "failed") stopFailed.add(`${hold.key}\u0000${hold.version}`);
            });
        }
        for (const failure of packages.failures) {
            logger.warn(`[Updater] could not read held updates on ${failure.computerName}: ${failure.error}`);
        }
    } catch (err) {
        logger.error("[Updater] could not read held package updates:", err);
    }
    // a held panel whose processes all stopped updates now
    for (const [key, task] of [...heldPanelTasks]) {
        const hold = updateQueue.hold(key);
        if (!hold) {
            heldPanelTasks.delete(key);
            continue;
        }
        try {
            const client = connectionPool.getClient(task.computerId);
            if (!client.getStatus().connected) continue;
            const running = await Promise.all(
                (holdProcesses.get(key) ?? []).map((id) => client.call<{ running?: boolean }>("process:exists", { id }).then((r) => r?.running === true)),
            );
            if (running.some(Boolean)) continue;
            heldPanelTasks.delete(key);
            void updateQueue.enqueue(taskJob(task));
        } catch (err) {
            logger.warn(`[Updater] could not look at what holds ${task.id} back:`, err);
        }
    }
    if (updateQueue.snapshot().holds.length > 0) {
        holdTimer = setTimeout(() => void refreshHolds(), HOLD_REFRESH_MS);
        holdTimer.unref?.();
    }
}

// the processes each held panel was running when it was held
const holdProcesses = new Map<string, string[]>();

// updates that were stopped for without asking and failed: they are not
// tried that way again, so a failing update can't stop processes over and
// over; they wait for Stop and update instead
const stopFailed = new Set<string>();

/**
 * Stop and update: the held updates join the queue as one job, which stops
 * what uses them once and starts it again after. They must be on one
 * computer. Resolves with their items once they ran; throws when one of
 * them is no longer held.
 */
export async function releaseHolds(keys: string[]): Promise<UpdateItem[]> {
    if (keys.length === 0) throw new Error("No update was chosen");
    const holds = keys.map((key) => updateQueue.hold(key));
    if (holds.some((hold) => !hold)) throw new Error("That update is no longer waiting");
    const items = await updateQueue.enqueue(inUseJob(holds as UpdateHold[]));
    for (const item of items) {
        if (item.status === "failed") logger.warn(`[Updater] Stop and update of ${item.name} failed: ${item.error}`);
    }
    return items;
}

function inUseJob(holds: UpdateHold[]): UpdateJob {
    const computerId = holds[0].computerId;
    if (holds.some((hold) => hold.computerId !== computerId)) throw new Error("Updates on different computers stop separately");
    for (const hold of holds) {
        heldPanelTasks.delete(hold.key);
        holdProcesses.delete(hold.key);
    }
    // the daemon names targets by panel id or package name
    const keyOf = new Map(holds.map((hold) => [`${hold.kind}:${hold.id}`, hold.key]));
    return {
        items: holds.map((hold) => ({
            key: hold.key,
            kind: hold.kind,
            computerId: hold.computerId,
            computerName: hold.computerName,
            panelId: hold.kind === "panel" ? hold.id : null,
            name: hold.name,
            version: hold.version,
        })),
        run: async (report) => {
            const progress = new Map(holds.map((hold) => [hold.key, progressReporter((p) => report(p, hold.key))]));
            const { failures } = await connectionPool.getClient(computerId).updateInUse(
                {
                    panels: holds.filter((h) => h.kind === "panel").map((h) => ({ id: h.id, version: h.version, sha256: h.sha256 ?? undefined })),
                    packages: holds.filter((h) => h.kind === "package").map((h) => h.id),
                },
                (target, payload) => {
                    const key = keyOf.get(target);
                    if (!key) throw new Error(`Paperboard Server reported progress for ${target}, which it was not asked to update`);
                    progress.get(key)!(payload);
                },
            );
            const failed = Object.entries(failures);
            if (failed.length > 0) {
                throw new PartialUpdateError(Object.fromEntries(failed.map(([target, why]) => [keyOf.get(target) ?? target, why])));
            }
        },
    };
}

function failedItem(key: string, kind: UpdateItem["kind"], computerId: string, computerName: string | null, name: string, version: string, error: string): UpdateItem {
    return { key, kind, computerId, computerName, panelId: null, name, version, status: "failed", stage: null, percent: null, bytesLoaded: null, bytesTotal: null, error };
}

function progressReporter(report: (progress: Parameters<Parameters<UpdateJob["run"]>[0]>[0]) => void) {
    return (payload: { stage?: string; percent?: number; bytesLoaded?: number; bytesTotal?: number }) => {
        const stage = payload.stage === "stopping" ? "stopping"
            : payload.stage === "downloading" || payload.stage === "checking" || payload.stage === "starting" ? "downloading"
            : payload.stage === "extracting" || payload.stage === "verifying" || payload.stage === "completed" ? "installing"
            : undefined;
        report({
            ...(stage ? { stage } : {}),
            // stopping and installing have no measure: only bytes do
            percent: stage === "downloading" && typeof payload.percent === "number" && payload.bytesTotal ? payload.percent : null,
            bytesLoaded: typeof payload.bytesLoaded === "number" ? payload.bytesLoaded : null,
            bytesTotal: typeof payload.bytesTotal === "number" ? payload.bytesTotal : null,
        });
    };
}

const appUpdaterLog = getLogger("electron-updater");

let autoUpdater: AppUpdater | null = null;

// downloads go to <PAPERBOARD_DIR>/local/electron/paperboard-updater
function platformUpdater(): AppUpdater {
    if (autoUpdater) return autoUpdater;
    const updater = createPlatformUpdater(electronDataDir());
    updater.logger = {
        info: (msg: string) => appUpdaterLog.info(String(msg)),
        warn: (msg: string) => appUpdaterLog.warn(String(msg)),
        error: (msg: string) => appUpdaterLog.error(String(msg)),
        debug: (msg: string) => appUpdaterLog.debug(String(msg)),
    } as any;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    autoUpdater = updater;
    return updater;
}

// a deb or rpm Paperboard published, on a machine that can install it itself
let packageUpdater: LinuxPackageUpdater | null = null;

/** Restarts into the downloaded update; throws when there is none to install. */
export function quitAndInstallAppUpdate(): void {
    if (packageUpdater) {
        const updater = packageUpdater;
        // a refused or failed install shows in the update dialog, and this
        // version keeps running
        void updater.install().then(
            () => {
                app.relaunch();
                app.quit();
            },
            (err) => updater.emit("error", err),
        );
        return;
    }
    if (!autoUpdater) throw new Error("no app update has been downloaded");
    autoUpdater.quitAndInstall(false, true);
}

let appUpdateSession: AppUpdateSession | null = null;
let packageDownload: string | null = null;

/** Where the user gets the latest Paperboard: their deb or rpm, else the downloads page. */
export function appUpdateDownloadUrl(): string {
    appUpdater();
    return packageDownload ?? "https://paperboard.dev/downloads/";
}

function appUpdater(): AppUpdateSession {
    if (appUpdateSession) return appUpdateSession;
    const install = process.platform === "linux" && !process.env.APPIMAGE
        ? linuxPackageInstall(process.resourcesPath, process.arch)
        : null;
    packageDownload = install?.download ?? null;
    if (install?.packageType) {
        const candidate = new LinuxPackageUpdater({
            currentVersion: app.getVersion(),
            feedUrl: install.feedUrl,
            downloadBase: DOWNLOAD_BASE,
            file: path.basename(new URL(install.download!).pathname),
            type: install.packageType,
            downloadDir: path.join(electronDataDir(), "paperboard-package-updater"),
            which: (cmd) => onPath(cmd),
        });
        // without pkexec or the package tool, the person installs it themselves
        if (candidate.canInstall) packageUpdater = candidate;
        else logger.info(`[Updater] this computer can't install a .${install.packageType} itself; updates are offered as a download`);
    }
    const updater = packageUpdater ?? (install ? new ManualAppUpdater(app.getVersion(), install.feedUrl) : platformUpdater());
    appUpdateSession = new AppUpdateSession(updater, (state) => {
        retainAppUpdateState(state);
        updateQueue.upsertItem(appUpdateItem(state));
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && isShellUrl(window.webContents.getURL())) {
                window.webContents.send("app-update-state", state);
            }
        }
    }, TASK_TIMEOUT_MS, !install || packageUpdater ? "automatic" : packageDownload ? "package-download" : "package-manager");
    return appUpdateSession;
}

export function disposeAppUpdater(): void {
    appUpdateSession?.dispose();
    stopBackgroundUpdates();
}

// Paperboard's own download, as the update list shows it
function appUpdateItem(state: AppUpdateState): UpdateItem {
    const status = state.status === "downloading" ? "running"
        : state.status === "ready" ? "done"
        : state.status === "failed" ? "failed"
        : "done";
    return {
        key: "app",
        kind: "app",
        computerId: "local",
        computerName: null,
        panelId: null,
        name: "Paperboard",
        version: state.version ?? "",
        status,
        stage: state.status === "downloading" ? "downloading" : null,
        percent: state.status === "downloading" ? state.percent : null,
        bytesLoaded: null,
        bytesTotal: null,
        error: state.status === "failed" ? state.error ?? "The update could not finish" : null,
    };
}

async function runOrchestratorInner(): Promise<number> {

    const [registryPanels, registryPackages, craneDlIndex] = await Promise.all([
        fetchIndex(`${REGISTRY_URL}/panels/index.json`),
        fetchIndex(`${REGISTRY_URL}/package/index.json`),
        fetchIndex(`${REGISTRY_URL}/paperdl/crane/index.json`),
    ]);

    // ping paired machines; an unreachable one is counted, and said
    const computers = connectionPool.listAll();

    interface ComputerState {
        id: string;
        name: string;
        isLocal: boolean;
        panels: any[];
        packages: Record<string, any>;
        sysInfo: any;
    }
    const computerStates: ComputerState[] = [];
    let unavailableComputers = 0;

    for (let offset = 0; offset < computers.length; offset += 8) {
    await Promise.all(
        computers.slice(offset, offset + 8).map(async ({ id, name }) => {
            try {
                const driver = connectionPool.getDriver(id);
                const [panels, packages, sysInfo] = await Promise.all([
                    withTimeout(driver.listPanels(), PING_TIMEOUT_MS),
                    withTimeout(
                        driver.getPackageIndex(),
                        PING_TIMEOUT_MS,
                    ),
                    withTimeout(driver.getSystemInfo(), PING_TIMEOUT_MS),
                ]);
                computerStates.push({
                    id,
                    name,
                    isLocal: id === "local",
                    panels: panels ?? [],
                    packages: packages ?? {},
                    sysInfo,
                });
            } catch (err) {
                unavailableComputers++;
                logger.debug(
                    `[Updater] computer ${id} (${name}) unreachable during ping:`,
                    err,
                );
            }
        }),
    );
    }

    // unlisted panels are out of the index but still update from their records
    const installed = await withInstalledRecords(computerStates, registryPanels, async (id) => {
        try {
            return await fetchRegistryJson(`${REGISTRY_URL}/panel/${encodeURIComponent(id)}.json`, FETCH_TIMEOUT_MS);
        } catch (err: any) {
            if (err?.status === 404) return null;
            throw err;
        }
    });

    // planning is electron-free (updatePlan.ts) so the checksum-gate tests
    // run without a window; execution below only runs planned tasks
    const tasks = await planUpdateTasks(
        computerStates,
        installed.panels,
        registryPackages,
        craneDlIndex,
        {
            registryUrl: REGISTRY_URL,
            readCraneVersion: async (computerId: string) => {
                try {
                    const cfg = await withTimeout(
                        connectionPool.getDriver(computerId).getConfig("crane_version"),
                        2000,
                    ).catch((err) => {
                        appUpdaterLog.debug(
                            `[Updater] crane_version config request from ${computerId} failed:`,
                            err,
                        );
                        return null;
                    });
                    return (cfg as { version?: string } | null)?.version ?? null;
                } catch (err) {
                    logger.debug(
                        `[Updater] failed to read crane_version config from ${computerId}:`,
                        err,
                    );
                    return null;
                }
            },
        },
    );

    let failures = unavailableComputers + installed.failures;
    const checkError = unavailableComputers
        ? `Paperboard could not reach ${unavailableComputers === 1 ? "1 computer" : `${unavailableComputers} computers`} to check for updates.`
        : installed.failures
          ? `Paperboard could not check ${installed.failures === 1 ? "1 panel" : `${installed.failures} panels`} for updates (${installed.reasons[0]}).`
          : null;
    updateQueue.setChecking(false, checkError);

    const results = (await Promise.all(tasks.map((task) => updateQueue.enqueue(taskJob(task))))).flat();
    for (const item of results) {
        if (item.status === "failed") {
            failures++;
            logger.warn(`[Updater] Failed: ${item.kind} ${item.name} on ${item.computerId}: ${item.error}`);
        }
    }
    return failures;
}

function taskJob(task: UpdateTask): UpdateJob {
    const kind = task.type === "local_panel" || task.type === "ext_panel" ? "panel"
        : task.type === "ext_crane" ? "server"
        : "package";
    const key = kind === "server" ? `server:${task.computerId}` : `${kind}:${task.computerId}:${task.id}`;
    return {
        items: [{
            key,
            kind,
            computerId: task.computerId,
            computerName: task.computerName,
            panelId: kind === "panel" ? task.id! : null,
            name: task.name,
            version: task.version,
        }],
        run: (report) => runTask(task, key, (progress) => report(progress)),
    };
}

async function runTask(task: UpdateTask, key: string, report: (progress: Parameters<Parameters<UpdateJob["run"]>[0]>[0]) => void): Promise<UpdateHold | void> {
    const driver = connectionPool.getDriver(task.computerId);
    const onProgress = progressReporter(report);
    switch (task.type) {
        case "local_panel":
        case "ext_panel": {
            const outcome = await withTimeout(
                driver.installPanel(task.id!, { version: task.version, sha256: task.sha256 }, { ifUnused: true, onProgress }),
                TASK_TIMEOUT_MS,
            );
            if ("held" in outcome) {
                heldPanelTasks.set(key, task);
                holdProcesses.set(key, outcome.held.processes);
                return {
                    key,
                    kind: "panel",
                    computerId: task.computerId,
                    computerName: task.computerName,
                    id: task.id!,
                    name: task.name,
                    version: task.version,
                    sha256: task.sha256 ?? null,
                    users: [task.name],
                };
            }
            return;
        }
        case "local_package":
        case "ext_package": {
            // execution-time backstop: a task without a checksum fact
            // never reaches the daemon, even if planning missed it
            if (!validSha256(task.sha256)) {
                throw new Error(
                    `Install refused for package "${task.id}": update task carries no sha256 checksum`,
                );
            }
            const outcome = await withTimeout(
                driver.downloadPackage(task.id!, `updater-${task.id}`, onProgress, task.sha256),
                PACKAGE_DOWNLOAD_TIMEOUT_MS,
            );
            if (outcome.waiting) {
                // only what people rely on holds it (important or long
                // running); anything else stops for it and starts again
                if (!outcome.waiting.blockedBy.some((user) => user.holds)) {
                    const { failures } = await withTimeout(
                        connectionPool.getClient(task.computerId).updateInUse({ packages: [task.id!] }, (_target, payload) => onProgress(payload)),
                        TASK_TIMEOUT_MS,
                    );
                    const failure = failures[`package:${task.id}`];
                    if (failure) throw new Error(failure);
                    return;
                }
                return {
                    key,
                    kind: "package",
                    computerId: task.computerId,
                    computerName: task.computerName,
                    id: task.id!,
                    name: task.name,
                    version: task.version,
                    sha256: null,
                    users: await packageUserNames(task.computerId, outcome.waiting.blockedBy),
                };
            }
            return;
        }
        case "ext_crane": {
            // execution-time backstop: crane self-update refuses
            // without a checksum exactly like panels and packages
            if (!validSha256(task.sha256)) {
                throw new Error(
                    `Install refused for Paperboard Server update on ${task.computerId}: update task carries no sha256 checksum`,
                );
            }
            if (typeof task.signature !== "string" || !task.signature) {
                throw new Error(
                    `Install refused for Paperboard Server update on ${task.computerId}: the release is not signed`,
                );
            }
            report({ stage: "installing", percent: null });
            const client = connectionPool.getClient(task.computerId);
            await client.updateCrane(task.version, task.downloadUrl, task.sha256, task.signature);
            // confirm before recording: system:update only initiates
            // (the daemon swaps and respawns), so persist
            // crane_version only when the new binary actually reports
            // back. A failed swap leaves the recorded version stale
            // and the next run retries instead of skipping a lie.
            const confirmed = await confirmCraneVersion(
                client,
                task.computerId,
                task.version!,
            );
            if (!confirmed) {
                throw new Error(
                    `Paperboard Server update to ${task.version} on ${task.computerName ?? task.computerId} did not report back`,
                );
            }
            try {
                await driver.setConfig("crane_version", { version: task.version });
            } catch (err) {
                logger.warn(
                    `[Updater] failed to persist crane_version on ${task.computerId}:`,
                    err,
                );
            }
            return;
        }
    }
}

// the panels whose important or long-running processes hold a package back, by name
async function packageUserNames(computerId: string, blockedBy: Array<{ owner: string | null; holds: boolean }>): Promise<string[]> {
    const owners = [...new Set(blockedBy.filter((b) => b.holds).map((b) => b.owner))];
    if (owners.every((o) => o === null)) return ["Paperboard"];
    const panels = await withTimeout(connectionPool.getClient(computerId).listPanels(), PING_TIMEOUT_MS);
    const names = new Map(panels.map((p) => [p.id, p.name || p.id]));
    return owners.map((o) => (o === null ? "Paperboard" : names.get(o) ?? o));
}
