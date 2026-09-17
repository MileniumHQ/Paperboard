import * as path from "path";
import { BrowserWindow } from "electron";
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
    try {
        await runOrchestratorInner(win);
    } catch (err) {
        logger.error("[Updater] update check failed:", err);
        sendProgress(win, null, "Could not check for updates. Try again when the registry is reachable", true);
        recordRunOutcome(1);
    } finally {
        orchestratorRunning = false;
    }
}

const appUpdaterLog = getLogger("electron-updater");

// electron-updater needs info/warn/error/debug; route to file logger
function wireAppUpdater(win: BrowserWindow): void {
    try {
        autoUpdater.logger = {
            info: (msg: string) => appUpdaterLog.info(String(msg)),
            warn: (msg: string) => appUpdaterLog.warn(String(msg)),
            error: (msg: string) => appUpdaterLog.error(String(msg)),
            debug: (msg: string) => appUpdaterLog.debug(String(msg)),
        } as any;
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.removeAllListeners("update-available");
        autoUpdater.removeAllListeners("download-progress");
        autoUpdater.removeAllListeners("update-downloaded");
        autoUpdater.removeAllListeners("error");
        const broadcast = (channel: string, payload: unknown) => {
            for (const w of BrowserWindow.getAllWindows()) {
                // R11: updater pushes are shell-surface events; the updater
                // window and main window are the only audiences. Panels
                // live in iframes of the main window and receive them via
                // the window's webContents — filtered by URL.
                if (w.isDestroyed()) continue;
                try {
                    const url = w.webContents.getURL?.() ?? "";
                    if (url.startsWith("panel://")) continue;
                    w.webContents.send(channel, payload);
                } catch (err) { logger.debug("[updater.ts] op failed:", err) }
            }
        };
        autoUpdater.on("update-available", (info: any) => {
            appUpdaterLog.info(`[Updater] app update available: ${info?.version ?? "unknown"}`);
            sendProgress(win, null, `Downloading app update ${info?.version ?? ""}…`.trim());
            broadcast("app-update-available", { version: info?.version ?? null });
        });
        autoUpdater.on("download-progress", (p: any) => {
            const percent = typeof p?.percent === "number" ? Math.round(p.percent) : null;
            sendProgress(
                win,
                percent,
                `Downloading app update${percent !== null ? ` ${percent}%` : ""}…`,
            );
            broadcast("app-update-progress", {
                percent,
                transferred: p?.transferred ?? null,
                total: p?.total ?? null,
            });
        });
        autoUpdater.on("update-downloaded", (info: any) => {
            appUpdaterLog.info(`[Updater] app update downloaded: ${info?.version ?? "unknown"}`);
            sendProgress(win, 100,         "App update ready. Restart to apply");
            broadcast("app-update-downloaded", { version: info?.version ?? null });
        });
        autoUpdater.on("error", (err: any) => {
            appUpdaterLog.warn("[Updater] app self-update error:", err?.message ?? err);
            // R7: the updater window's only failure terminal state comes
            // from here — without it the window sat on "Downloading app
            // update…" forever. `failed: true` is the renderer's signal
            // to render the error state; Skip stays the only control.
            sendProgress(win, null,         "Update failed. You can keep using Paperboard", true);
        });
        autoUpdater
            .checkForUpdates()
            .catch((err) =>
                appUpdaterLog.debug("[Updater] app self-update check failed:", err),
            );
    } catch (err) {
        logger.debug("[Updater] failed to initialize electron-updater:", err);
    }
}

async function runOrchestratorInner(
    win: BrowserWindow,
): Promise<void> {
    wireAppUpdater(win);

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
        sendProgress(win, 100, unavailableComputers ? `Could not check ${unavailableComputers} computer(s). Reconnect and try again` : "Everything is up to date!", unavailableComputers > 0);
        recordRunOutcome(unavailableComputers);
        return;
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
                        driver.installPanel(task.id!, task.downloadUrl, task.sha256),
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
                    const client = connectionPool.getClient(task.computerId);
                    await client.updateCrane(task.version, task.downloadUrl, task.sha256);
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

    sendProgress(win, 100, failures > 0 ? `Done (${failures} failed)` : "Done!");

    recordRunOutcome(failures);
}
