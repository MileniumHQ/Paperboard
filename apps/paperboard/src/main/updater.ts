import * as path from "path";
import { app, BrowserWindow } from "electron";
import { AppUpdateSession, getAppUpdateState, retainAppUpdateState } from "./appUpdateSession";
import { ManualAppUpdater } from "./manualAppUpdater";
import { isShellUrl } from "./communication/shellGuard";
import { autoUpdater } from "electron-updater";
import { is } from "@electron-toolkit/utils";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { resolveRegistryUrl, withTimeout } from "../../papercrane/util";
import { validSha256 } from "./updatePlan";
import { planUpdateTasks } from "./updatePlan";
export type { UpdateTask, UpdateTaskType } from "./updatePlan";
import { readJsonFileSync, writeFileAtomicSync } from "../../papercrane/storage";
import { getLocalDir } from "../../papercrane/paths";
import { logger, getLogger } from "../../papercrane/logger";
import { fetchRegistryJson } from "../../../../packages/paperapi/src/config";

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

function sendProgress(
    win: BrowserWindow,
    progress: number | null,
    label: string,
    failed = false,
) {
    if (!win.isDestroyed()) {
        win.webContents.send("updater-progress", { progress, label, failed });
    }
}

interface UpdateState {
    lastUpdate?: number;
    consecutiveFailures?: number;
}

export function shouldSkipUpdate(argv: string[]): boolean {
    if (argv.includes("--skip-update")) return true;
    if (argv.includes("--update")) return false;
    const { lastUpdate } = readUpdateState();
    return Boolean(
        lastUpdate && Date.now() - lastUpdate < UPDATE_COOLDOWN_MS,
    );
}

function readUpdateState(): UpdateState {
    try {
        return readJsonFileSync<UpdateState>(TIMESTAMP_FILE, {});
    } catch (err) {
        logger.warn("[Updater] failed to read update state:", err);
        return {};
    }
}

function writeUpdateState(state: UpdateState) {
    try {
        writeFileAtomicSync(TIMESTAMP_FILE, JSON.stringify(state));
    } catch (err) {
        logger.warn("[Updater] failed to save update state:", err);
    }
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

export async function runUpdateOrchestrator(
    win: BrowserWindow,
): Promise<void> {
    if (orchestratorRunning) {
        logger.debug("[Updater] orchestrator already running, skipping");
        sendProgress(win, 100, "Update check already in progress");
        return;
    }
    orchestratorRunning = true;
    let failures = 0;
    let appRun: Promise<import("../shared/appUpdate").AppUpdateState> | null = null;
    try {
        appRun = appUpdater().check();
        failures = await runOrchestratorInner(win);
    } catch (err) {
        failures++;
        logger.error("[Updater] update check failed:", err);
        sendProgress(win, null, "Could not check for updates. Try again when the registry is reachable", true);
    } finally {
        try {
            const state = appRun ? await appRun : getAppUpdateState();
            if (state.status === "failed") failures++;
            recordRunOutcome(failures);
        } finally {
            orchestratorRunning = false;
        }
    }
}

const appUpdaterLog = getLogger("electron-updater");

let appUpdateSession: AppUpdateSession | null = null;

function appUpdater(): AppUpdateSession {
    if (appUpdateSession) return appUpdateSession;
    autoUpdater.logger = {
        info: (msg: string) => appUpdaterLog.info(String(msg)),
        warn: (msg: string) => appUpdaterLog.warn(String(msg)),
        error: (msg: string) => appUpdaterLog.error(String(msg)),
        debug: (msg: string) => appUpdaterLog.debug(String(msg)),
    } as any;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const packageManaged = process.platform === "linux" && !process.env.APPIMAGE;
    const updater = packageManaged
        ? new ManualAppUpdater(app.getVersion(), "https://i.paperboard.dev/pb/latest-linux.yml")
        : autoUpdater;
    appUpdateSession = new AppUpdateSession(updater, (state) => {
        retainAppUpdateState(state);
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && isShellUrl(window.webContents.getURL())) {
                window.webContents.send("app-update-state", state);
            }
        }
    }, TASK_TIMEOUT_MS, packageManaged ? "package-manager" : "automatic");
    return appUpdateSession;
}

export function disposeAppUpdater(): void {
    appUpdateSession?.dispose();
}

async function runOrchestratorInner(
    win: BrowserWindow,
): Promise<number> {

    sendProgress(win, null, "Checking for updates…");

    sendProgress(win, null, "Fetching indexes…");
    const [registryPanels, registryPackages, craneDlIndex] = await Promise.all([
        fetchIndex(`${REGISTRY_URL}/panels/index.json`),
        fetchIndex(`${REGISTRY_URL}/package/index.json`),
        fetchIndex(`${REGISTRY_URL}/paperdl/crane/index.json`),
    ]);

    // ping paired machines; failures ignored
    sendProgress(win, null, "Checking computers…");
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

    sendProgress(win, null, "Planning updates…");
    // planning is electron-free (updatePlan.ts) so the checksum-gate tests
    // run without a window; execution below only runs planned tasks
    const tasks = await planUpdateTasks(
        computerStates,
        registryPanels,
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

    const total = tasks.length;
    if (total === 0) {
        sendProgress(win, 100, unavailableComputers ? `Could not check ${unavailableComputers} computer(s). Reconnect and try again` : "Panel and server check complete", unavailableComputers > 0);
        return unavailableComputers;
    }

    let failures = unavailableComputers;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        sendProgress(win, Math.round((i / total) * 100), task.label);
        try {
            const driver = connectionPool.getDriver(task.computerId);
            switch (task.type) {
                case "local_panel":
                case "ext_panel":
                    await withTimeout(
                        driver.installPanel(task.id!, { version: task.version, sha256: task.sha256 }),
                        TASK_TIMEOUT_MS,
                    );
                    break;
                case "local_package":
                case "ext_package": {
                    // execution-time backstop: a task without a checksum fact
                    // never reaches the daemon, even if planning missed it
                    if (!validSha256(task.sha256)) {
                        throw new Error(
                            `Install refused for package "${task.id}": update task carries no sha256 checksum`,
                        );
                    }
                    await withTimeout(
                        driver.downloadPackage(
                            task.id!,
                            `updater-${task.id}`,
                            (payload) => {
                                logger.debug(
                                    `[Updater] package ${task.id} progress:`,
                                    payload?.stage ?? payload,
                                );
                            },
                            task.sha256,
                        ),
                        TASK_TIMEOUT_MS,
                    );
                    break;
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
                            `Paperboard Server update to ${task.version} on ${task.computerId} did not report back: refusing to record the version`,
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
                    break;
                }
            }
        } catch (err: any) {
            failures++;
            logger.warn(
                `[Updater] Failed: ${task.type} ${task.id ?? ""} on ${task.computerId}:`,
                err?.message,
            );
        }
    }

    sendProgress(win, 100, failures > 0 ? `Done (${failures} failed)` : "Done!", failures > 0);
    return failures;
}
