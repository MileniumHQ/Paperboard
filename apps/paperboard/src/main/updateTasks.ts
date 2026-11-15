// Running a planned update (updatePlan.ts) on its computer, as a job of the
// update queue: panels and packages install unless something people rely on
// is using them (then the job ends held), and Paperboard Server replaces
// itself and must report the new version back.
import connectionPool from "./communication/papercrane/ConnectionPool";
import { withTimeout } from "../../papercrane/util";
import { logger } from "../../papercrane/logger";
import { validSha256, type UpdateTask } from "./updatePlan";
import { PartialUpdateError, type UpdateJob, type UpdateProgress } from "./updateQueue";
import type { UpdateHold, UpdateItem } from "../shared/updateQueue";

export const PING_TIMEOUT_MS = 5_000;
export const TASK_TIMEOUT_MS = 10 * 60_000;

/** a panel held by its processes: what to install once they are gone, by hold key */
export const heldPanels = new Map<string, { task: UpdateTask; processes: string[] }>();

// polls system:info until the respawned daemon reports the target version.
// system:update only initiates the swap; the version fact is recorded only
// on this confirmation, never optimistically.
async function confirmCraneVersion(computerId: string, version: string, timeoutMs = 90_000): Promise<boolean> {
    const client = connectionPool.getClient(computerId);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        // the daemon is restarting: a failed answer is a reason to ask again
        const info = await client.getSystemInfo().catch((err) => {
            logger.debug(`[Updater] ${computerId} not answering yet after its update:`, err);
            return null;
        });
        if (info?.version === version) return true;
        if (Date.now() >= deadline) {
            logger.warn(`[Updater] Paperboard Server on ${computerId} never reported version ${version} after update`);
            return false;
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
}

export function failedItem(key: string, kind: UpdateItem["kind"], computerId: string, computerName: string | null, name: string, version: string, error: string): UpdateItem {
    return { key, kind, computerId, computerName, panelId: null, name, version, status: "failed", stage: null, percent: null, bytesLoaded: null, bytesTotal: null, error };
}

/** the daemon's progress payloads as the update list shows them */
function progressReporter(report: (progress: UpdateProgress) => void) {
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

/**
 * Stop and update: the held updates as one job, which stops what uses them
 * once and starts it again after. They must be on one computer.
 */
export function inUseJob(holds: UpdateHold[]): UpdateJob {
    const computerId = holds[0].computerId;
    if (holds.some((hold) => hold.computerId !== computerId)) throw new Error("Updates on different computers stop separately");
    for (const hold of holds) heldPanels.delete(hold.key);
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
                    // a push has no caller to throw to
                    const key = keyOf.get(target);
                    if (key) progress.get(key)!(payload);
                    else logger.error(`[Updater] Paperboard Server reported progress for ${target}, which it was not asked to update`);
                },
            );
            const failed = Object.entries(failures);
            if (failed.length > 0) {
                throw new PartialUpdateError(Object.fromEntries(failed.map(([target, why]) => [keyOf.get(target) ?? target, why])));
            }
        },
    };
}

export function taskJob(task: UpdateTask): UpdateJob {
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
        run: (report) => {
            const onProgress = progressReporter((progress) => report(progress));
            if (task.type === "local_panel" || task.type === "ext_panel") return installPanel(task, key, onProgress);
            if (task.type === "ext_crane") return updateServer(task, report);
            return installPackage(task, key, onProgress);
        },
    };
}

type OnProgress = ReturnType<typeof progressReporter>;

async function installPanel(task: UpdateTask, key: string, onProgress: OnProgress): Promise<UpdateHold | void> {
    // the RPC carries its own timeout, as long as the daemon's download may
    // run: a shorter one here would show "failed" while the daemon installs
    const outcome = await connectionPool.getClient(task.computerId).installPanel(task.id!, { version: task.version, sha256: task.sha256 }, { ifUnused: true, onProgress });
    if (!("held" in outcome)) return;
    heldPanels.set(key, { task, processes: outcome.held.processes });
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

async function installPackage(task: UpdateTask, key: string, onProgress: OnProgress): Promise<UpdateHold | void> {
    // execution-time backstop: a task without a checksum fact
    // never reaches the daemon, even if planning missed it
    if (!validSha256(task.sha256)) {
        throw new Error(`Install refused for package "${task.id}": update task carries no sha256 checksum`);
    }
    const outcome = await connectionPool.getClient(task.computerId).downloadPackage(task.id!, `updater-${task.id}`, onProgress, task.sha256);
    if (!outcome.waiting) return;
    // only what people rely on holds it (important or long running);
    // anything else stops for it and starts again
    if (!outcome.waiting.blockedBy.some((user) => user.holds)) {
        const { failures } = await connectionPool.getClient(task.computerId).updateInUse({ packages: [task.id!] }, (_target, payload) => onProgress(payload));
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

async function updateServer(task: UpdateTask, report: (progress: UpdateProgress) => void): Promise<void> {
    // execution-time backstop: crane self-update refuses
    // without a checksum exactly like panels and packages
    if (!validSha256(task.sha256)) {
        throw new Error(`Install refused for Paperboard Server update on ${task.computerId}: update task carries no sha256 checksum`);
    }
    if (typeof task.signature !== "string" || !task.signature) {
        throw new Error(`Install refused for Paperboard Server update on ${task.computerId}: the release is not signed`);
    }
    report({ stage: "installing", percent: null });
    await connectionPool.getClient(task.computerId).updateCrane(task.version, task.downloadUrl, task.sha256, task.signature);
    // confirm before recording: system:update only initiates (the daemon
    // swaps and respawns), so crane_version is persisted only when the new
    // binary actually reports back. A failed swap leaves the recorded
    // version stale and the next run retries instead of skipping a lie.
    if (!(await confirmCraneVersion(task.computerId, task.version))) {
        throw new Error(`Paperboard Server update to ${task.version} on ${task.computerName ?? task.computerId} did not report back`);
    }
    try {
        await connectionPool.getClient(task.computerId).setConfig("crane_version", { version: task.version });
    } catch (err) {
        logger.warn(`[Updater] failed to persist crane_version on ${task.computerId}:`, err);
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
