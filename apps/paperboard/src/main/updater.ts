import * as path from "path";
import { BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { is } from "@electron-toolkit/utils";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { semverGt } from "../../papercrane/util";
import { readJsonFileSync, writeFileAtomicSync } from "../../papercrane/storage";
import { getLocalDir } from "../../papercrane/paths";
import { logger } from "../../papercrane/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

// Registry override only honored in dev so users can't be pointed at arbitrary hosts
const REGISTRY_URL =
    (is.dev && process.env.ORIGAMI_REGISTRY_URL) ||
    "https://origami.ariapis.com";
const UPDATE_COOLDOWN_MS = 30 * 60 * 1000;
const PING_TIMEOUT_MS = 5_000;
const TASK_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const FAILURE_COOLDOWN_RUNS = 2;
const TIMESTAMP_FILE = path.join(getLocalDir(), "last_update.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export type UpdateTaskType =
    | "local_panel"
    | "local_package"
    | "ext_panel"
    | "ext_package"
    | "ext_crane";

export interface UpdateTask {
    type: UpdateTaskType;
    computerId: string;
    id?: string;
    version: string;
    downloadUrl: string;
    label: string;
    sha256?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendProgress(
    win: BrowserWindow,
    progress: number | null,
    label: string,
) {
    if (!win.isDestroyed()) {
        win.webContents.send("updater-progress", { progress, label });
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

// Fully clean run resets the failure streak and arms the cooldown
function saveCleanRun() {
    writeUpdateState({ lastUpdate: Date.now(), consecutiveFailures: 0 });
}

// Arm cooldown only after repeated failing runs so a single bad task still retries
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), ms),
        ),
    ]);
}

// Fetch a registry index with a hard timeout; aborts count as failures
async function fetchIndex(
    url: string,
): Promise<Record<string, any>> {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        return res.ok ? ((await res.json()) ?? {}) : {};
    } catch (err: any) {
        const aborted =
            err?.name === "TimeoutError" || err?.name === "AbortError";
        logger.warn(
            `[Updater] registry index fetch failed (${url}):`,
            aborted
                ? `aborted after ${FETCH_TIMEOUT_MS}ms timeout`
                : err?.message ?? err,
        );
        return {};
    }
}

// Guard against overlapping runs so a stalled run can't double-download or double-install
let orchestratorRunning = false;

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runUpdateOrchestrator(
    win: BrowserWindow,
): Promise<void> {
    if (orchestratorRunning) {
        // Previous run still mid-task — let this launch proceed without redoing work
        logger.debug("[Updater] orchestrator already running, skipping");
        sendProgress(win, 100, "Update check already in progress");
        return;
    }
    orchestratorRunning = true;
    try {
        await runOrchestratorInner(win);
    } finally {
        orchestratorRunning = false;
    }
}

async function runOrchestratorInner(
    win: BrowserWindow,
): Promise<void> {
    // electron-updater handles the app binary with its own built-in UI — fire & forget
    try {
        autoUpdater.logger = null;
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater
            .checkForUpdates()
            .catch((err) =>
                logger.debug("[Updater] app self-update check failed:", err),
            );
    } catch (err) {
        logger.debug("[Updater] failed to initialize electron-updater:", err);
    }

    // ── INDETERMINATE PHASE ──────────────────────────────────────────────────

    sendProgress(win, null, "Checking for updates…");

    // 1. Fetch registry indexes in parallel
    sendProgress(win, null, "Fetching indexes…");
    const [registryPanels, registryPackages, craneDlIndex] = await Promise.all([
        fetchIndex(`${REGISTRY_URL}/panels/index.json`),
        fetchIndex(`${REGISTRY_URL}/package/index.json`),
        fetchIndex(`${REGISTRY_URL}/paperdl/crane/index.json`),
    ]);

    // 2. Ping all paired computers (failures are expected and ignored)
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

    await Promise.allSettled(
        computers.map(async ({ id, name }) => {
            try {
                const driver = connectionPool.getDriver(id);
                const [panels, packages, sysInfo] = await Promise.all([
                    withTimeout(driver.listPanels(), PING_TIMEOUT_MS).catch(
                        () => [] as any[],
                    ),
                    withTimeout(
                        driver.getPackageIndex(),
                        PING_TIMEOUT_MS,
                    ).catch(() => ({} as Record<string, any>)),
                    withTimeout(driver.getSystemInfo(), PING_TIMEOUT_MS).catch(
                        () => null,
                    ),
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
                // Unreachable — skip
                logger.debug(
                    `[Updater] computer ${id} (${name}) unreachable during ping:`,
                    err,
                );
            }
        }),
    );

    // 3. Build update task queue
    sendProgress(win, null, "Planning updates…");
    const tasks: UpdateTask[] = [];

    for (const comp of computerStates) {
        // Panel updates
        for (const panel of comp.panels) {
            const reg = registryPanels[panel.id];
            if (!reg?.version || !panel.version) continue;
            if (!semverGt(reg.version, panel.version)) continue;
            tasks.push({
                type: comp.isLocal ? "local_panel" : "ext_panel",
                computerId: comp.id,
                id: panel.id,
                version: reg.version,
                downloadUrl:
                    reg.downloadUrl ??
                    `${REGISTRY_URL}/panel/${panel.id}/download`,
                label: `Updating panel ${panel.name || panel.id}${comp.isLocal ? "" : ` on ${comp.name}`}`,
                sha256: typeof reg.sha256 === "string" ? reg.sha256 : undefined,
            });
        }

        // Package updates (only for already-installed packages)
        for (const [pkgId, installed] of Object.entries(comp.packages)) {
            const reg = registryPackages[pkgId];
            if (!reg?.version || !(installed as any)?.version) continue;
            if (!semverGt(reg.version, (installed as any).version)) continue;
            const platform: string = comp.sysInfo?.os ?? "linux";
            const arch: string = (comp.sysInfo?.arch ?? "x64").includes("arm")
                ? "arm64"
                : "x64";
            const platformData = reg.platforms?.[`${platform}-${arch}`];
            if (!platformData?.url) continue;
            tasks.push({
                type: comp.isLocal ? "local_package" : "ext_package",
                computerId: comp.id,
                id: pkgId,
                version: reg.version,
                downloadUrl: platformData.url,
                label: `Updating ${pkgId}${comp.isLocal ? "" : ` on ${comp.name}`}`,
            });
        }

        // PaperCrane self-update (remote computers only)
        if (!comp.isLocal && comp.sysInfo) {
            const platform: string =
                comp.sysInfo.os === "darwin" ? "macos" : comp.sysInfo.os ?? "linux";
            const arch: string = (comp.sysInfo.arch ?? "x64").includes("arm")
                ? "arm64"
                : "x64";
            const craneEntry = craneDlIndex[`${platform}-${arch}`];
            if (!craneEntry?.version) continue;

            let currentCraneVersion: string | null =
                comp.sysInfo.version || comp.sysInfo.craneVersion || null;
            if (!currentCraneVersion) {
                try {
                    const cfg = await withTimeout(
                        connectionPool.getDriver(comp.id).getConfig("crane_version"),
                        2000,
                    ).catch(() => null);
                    currentCraneVersion =
                        (cfg as { version?: string } | null)?.version ?? null;
                } catch (err) {
                    logger.debug(
                        `[Updater] failed to read crane_version config from ${comp.id}:`,
                        err,
                    );
                }
            }

            if (!currentCraneVersion || semverGt(craneEntry.version, currentCraneVersion)) {
                tasks.push({
                    type: "ext_crane",
                    computerId: comp.id,
                    version: craneEntry.version,
                    downloadUrl:
                        craneEntry.downloadUrl ??
                        `${REGISTRY_URL}/paperdl/crane/${platform}-${arch}/download`,
                    label: `Updating PaperCrane on ${comp.name}`,
                    sha256:
                        typeof craneEntry.sha256 === "string"
                            ? craneEntry.sha256
                            : undefined,
                });
            }
        }
    }

    // ── DETERMINATE PHASE ────────────────────────────────────────────────────

    const total = tasks.length;
    if (total === 0) {
        sendProgress(win, 100, "Everything is up to date!");
        saveCleanRun();
        return;
    }

    let failures = 0;

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
                case "ext_package":
                    await withTimeout(
                        driver.downloadPackage(
                            task.id!,
                            `updater-${task.id}`,
                            () => {},
                        ),
                        TASK_TIMEOUT_MS,
                    );
                    break;
                case "ext_crane": {
                    const client = connectionPool.getClient(task.computerId);
                    await client
                        .updateCrane(task.version, task.downloadUrl, task.sha256)
                        .catch((err) => {
                            logger.warn(
                                `[Updater] crane self-update call failed on ${task.computerId}:`,
                                err,
                            );
                        });
                    await driver
                        .setConfig("crane_version", { version: task.version })
                        .catch((err) => {
                            logger.warn(
                                `[Updater] failed to persist crane_version on ${task.computerId}:`,
                                err,
                            );
                        });
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

    // Clean run resets the failure streak; cooldown only arms after repeated failing runs
    recordRunOutcome(failures);
}
