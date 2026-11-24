// The updater: looks for updates of Paperboard, its panels, runtime packages
// and paired computers' Paperboard Server, now (unless one ran recently) and
// every few hours, and runs what it found in the update queue. Paperboard's
// own update is appUpdater.ts; running one update is updateTasks.ts; what
// holds updates back is updateHolds.ts.
import * as path from "path";
import { is } from "@electron-toolkit/utils";
import { getAppUpdateState } from "./appUpdateSession";
import { appUpdater } from "./appUpdater";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { resolveRegistryUrl, withTimeout } from "daemon/core/util";
import { planUpdateTasks, withInstalledRecords, type ComputerUpdateState } from "./updatePlan";
import { readStateFileSync, writeFileAtomicSync } from "daemon/core/storage";
import { getLocalDir } from "daemon/core/paths";
import { logger } from "daemon/core/logger";
import { fetchRegistryJson } from "@mileniumhq/paperapi/config";
import { updateQueue } from "./updateQueue";
import { refreshHolds, resumeHoldRefresh, stopHoldRefresh } from "./updateHolds";
import { PING_TIMEOUT_MS, taskJob } from "./updateTasks";
import type { AppUpdateState } from "../shared/appUpdate";
import type { UpdateCheckOutcome } from "../shared/updateQueue";
import { errorMessage } from "@mileniumhq/paperapi/errors";

// registry override policy shared with the daemon: env override honored only
// outside production (dev/preview here) or with --allow-registry-override
export const REGISTRY_URL = resolveRegistryUrl({
    nodeEnv: is.dev ? "development" : "production",
    env: process.env,
    argv: process.argv,
});
const UPDATE_COOLDOWN_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const FAILURE_COOLDOWN_RUNS = 2;
const TIMESTAMP_FILE = path.join(getLocalDir(), "last_update.json");

// how often a running Paperboard looks for updates again
const RECHECK_MS = 6 * 60 * 60_000;

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
        // updater on bookkeeping we cannot trust, and say so in the top bar
        logger.warn("[Updater] update state unreadable; skipping this run:", err);
        updateQueue.setChecking(false, `Paperboard didn't look for updates: ${errorMessage(err)}`);
        return true;
    }
    const { lastUpdate } = state;
    return Boolean(
        lastUpdate && Date.now() - lastUpdate < UPDATE_COOLDOWN_MS,
    );
}

function readUpdateState(): UpdateState {
    // the app's own state: corrupt bytes are quarantined beside the file (not
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

// one run at a time, so a stalled run can't double-install: a look asked
// for while one runs gets that run's outcome
let running: Promise<UpdateCheckOutcome> | null = null;

/**
 * Looks for updates of Paperboard, its panels, runtime packages and paired
 * computers' Paperboard Server, and runs them in the update queue. A panel
 * or package in use is held, not stopped. Resolves once the queue has run
 * every update it found, with what that came to.
 */
export function runUpdateOrchestrator(): Promise<UpdateCheckOutcome> {
    running ??= runOrchestrator().finally(() => {
        running = null;
    });
    return running;
}

async function runOrchestrator(): Promise<UpdateCheckOutcome> {
    let outcome: UpdateCheckOutcome = { updated: 0, held: 0, failed: 0, linked: 0, problem: null };
    let appRun: Promise<AppUpdateState> | null = null;
    updateQueue.setChecking(true);
    try {
        appRun = appUpdater().check();
        outcome = await runOrchestratorInner();
    } catch (err) {
        logger.error("[Updater] update check failed:", err);
        outcome = { ...outcome, failed: outcome.failed + 1, problem: `Paperboard could not check for updates: ${errorMessage(err)}` };
        updateQueue.setChecking(false, outcome.problem);
    }
    try {
        const state = appRun ? await appRun : getAppUpdateState();
        if (state.status === "failed") {
            outcome = { ...outcome, failed: outcome.failed + 1, problem: outcome.problem ?? `Paperboard itself didn't update: ${state.error ?? "the update failed"}` };
        }
        if (state.status === "downloading" || state.status === "ready") outcome = { ...outcome, updated: outcome.updated + 1 };
        recordRunOutcome(outcome.failed);
    } catch (err) {
        // the cooldown bookkeeping wasn't saved: the update list says so
        logger.error("[Updater] could not record the update check:", err);
        const earlier = updateQueue.snapshot().checkError;
        const said = `Paperboard could not record this update check: ${errorMessage(err)}`;
        updateQueue.setChecking(false, earlier ? `${earlier} ${said}` : said);
        outcome = { ...outcome, problem: outcome.problem ?? said };
    } finally {
        // staged runtime updates may now wait for panels to stop
        await refreshHolds();
    }
    return outcome;
}

let recheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background updater: a look for updates now (unless one ran
 * recently), and again every few hours while Paperboard runs.
 */
export function startBackgroundUpdates(argv: string[]): void {
    if (recheckTimer) return;
    resumeHoldRefresh();
    if (!shouldSkipUpdate(argv)) void runUpdateOrchestrator().catch((err) => logger.error("[Updater] Orchestrator error:", err));
    else void refreshHolds();
    recheckTimer = setInterval(() => {
        void runUpdateOrchestrator().catch((err) => logger.error("[Updater] Orchestrator error:", err));
    }, RECHECK_MS);
    recheckTimer.unref?.();
}

export function stopBackgroundUpdates(): void {
    if (recheckTimer) clearInterval(recheckTimer);
    recheckTimer = null;
    stopHoldRefresh();
}

/** Looks for updates now, whatever the cooldown says (Settings, Update everything now), and says what that came to. */
export function checkForUpdatesNow(): Promise<UpdateCheckOutcome> {
    return runUpdateOrchestrator();
}

// every paired computer's panels, packages and system, eight at a time; a
// computer that doesn't answer all three is counted, and said
async function pingComputers(): Promise<{ reached: ComputerUpdateState[]; unavailable: number }> {
    const reached: ComputerUpdateState[] = [];
    let unavailable = 0;
    await connectionPool.forEachComputer(async ({ id, name }) => {
        try {
            const client = connectionPool.getClient(id);
            const [panels, packages, sysInfo] = await Promise.all([
                withTimeout(client.listPanels(), PING_TIMEOUT_MS),
                withTimeout(client.getPackageIndex(), PING_TIMEOUT_MS),
                withTimeout(client.getSystemInfo(), PING_TIMEOUT_MS),
            ]);
            reached.push({ id, name, isLocal: id === "local", panels, packages, sysInfo });
        } catch (err) {
            unavailable++;
            logger.warn(`[Updater] could not reach ${name} (${id}) to check for updates:`, err);
        }
    });
    return { reached, unavailable };
}

// the Paperboard Server version a computer recorded, when its system:info doesn't say
async function readCraneVersion(computerId: string): Promise<string | null> {
    try {
        const cfg = await withTimeout(connectionPool.getClient(computerId).getConfig("crane_version"), 2000);
        return typeof cfg === "object" && cfg !== null && "version" in cfg && typeof cfg.version === "string" ? cfg.version : null;
    } catch (err) {
        // planning refuses an update over an unknown version, and says so
        logger.debug(`[Updater] could not read crane_version from ${computerId}:`, err);
        return null;
    }
}

// the panels, packages and servers to update; resolves with what that came to
async function runOrchestratorInner(): Promise<UpdateCheckOutcome> {
    const [registryPanels, registryPackages, craneDlIndex] = await Promise.all([
        fetchIndex(`${REGISTRY_URL}/panels/index.json`),
        fetchIndex(`${REGISTRY_URL}/package/index.json`),
        fetchIndex(`${REGISTRY_URL}/paperdl/crane/index.json`),
    ]);
    const { reached, unavailable } = await pingComputers();

    // unlisted panels are out of the index but still update from their records
    const installed = await withInstalledRecords(reached, registryPanels, async (id) => {
        try {
            return await fetchRegistryJson(`${REGISTRY_URL}/panel/${encodeURIComponent(id)}.json`, FETCH_TIMEOUT_MS);
        } catch (err: any) {
            if (err?.status === 404) return null;
            throw err;
        }
    });

    // planning is electron-free (updatePlan.ts); only planned tasks run
    const { tasks, refused } = await planUpdateTasks(reached, installed.panels, registryPackages, craneDlIndex, {
        registryUrl: REGISTRY_URL,
        readCraneVersion,
    });

    for (const reason of refused) logger.warn(`[Updater] refused an update: ${reason}`);
    const checkError = unavailable
        ? `Paperboard could not reach ${unavailable === 1 ? "1 computer" : `${unavailable} computers`} to check for updates.`
        : installed.failures
          ? `Paperboard could not check ${installed.failures === 1 ? "1 panel" : `${installed.failures} panels`} for updates (${installed.reasons[0]}).`
          : refused.length
            ? `Paperboard refused ${refused.length === 1 ? "1 update" : `${refused.length} updates`} it could not verify (${refused[0]}).`
            : null;
    updateQueue.setChecking(false, checkError);

    const outcome: UpdateCheckOutcome = {
        updated: 0,
        held: 0,
        failed: unavailable + installed.failures + refused.length,
        // a linked panel runs from its source folder: there is nothing to install over it
        linked: reached.reduce((sum, comp) => sum + comp.panels.filter((p) => p.isDevLink || p.isLinked).length, 0),
        problem: checkError,
    };
    const results = (await Promise.all(tasks.map((task) => updateQueue.enqueue(taskJob(task))))).flat();
    for (const item of results) {
        if (item.status === "done") outcome.updated++;
        else if (item.status === "held") outcome.held++;
        else if (item.status === "failed") {
            outcome.failed++;
            outcome.problem ??= `${item.name} didn't update: ${item.error ?? "the update failed"}`;
            logger.warn(`[Updater] Failed: ${item.kind} ${item.name} on ${item.computerId}: ${item.error}`);
        }
    }
    return outcome;
}
