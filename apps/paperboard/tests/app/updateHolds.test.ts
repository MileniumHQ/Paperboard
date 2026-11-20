import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import connectionPool from "../../src/main/communication/papercrane/ConnectionPool";
import type { PackageUpdateWait } from "../../src/main/communication/papercrane/PaperCraneClient";
import { refreshHolds, stopHoldRefresh } from "../../src/main/updateHolds";
import type { UpdateTask } from "../../src/main/updatePlan";
import { updateQueue } from "../../src/main/updateQueue";
import { heldPanels } from "../../src/main/updateTasks";

// What holds updates back is read from each computer's daemon: a held panel
// updates once its processes stop, an update that failed when stopped for
// without asking waits for Stop and update, and a computer that can't say
// what waits on it is named in the update list instead of dropping out.

// the daemon of this computer, as the hold refresh asks it
const daemon = {
    pending: [] as PackageUpdateWait[],
    pendingError: null as string | null,
    running: new Set<string>(),
    installs: [] as string[],
    stopAndUpdates: [] as string[][],
    stopAndUpdateFailure: null as string | null,
};

const client = {
    getStatus: () => ({ connected: true, isRemote: false, host: "127.0.0.1", port: 1 }),
    pendingPackageUpdates: async () => {
        if (daemon.pendingError) throw new Error(daemon.pendingError);
        return daemon.pending;
    },
    listPanels: async () => [],
    call: async (action: string, params: { id: string }) => {
        if (action !== "process:exists") throw new Error(`unexpected ${action}`);
        return { running: daemon.running.has(params.id) };
    },
    installPanel: async (panelId: string) => {
        daemon.installs.push(panelId);
        return { panel: { id: panelId } };
    },
    updateInUse: async (targets: { packages?: string[] }) => {
        daemon.stopAndUpdates.push(targets.packages ?? []);
        const failures: Record<string, string> = {};
        if (daemon.stopAndUpdateFailure) for (const name of targets.packages ?? []) failures[`package:${name}`] = daemon.stopAndUpdateFailure;
        return { panels: [], failures };
    },
};

const realGetClient = connectionPool.getClient.bind(connectionPool);
connectionPool.getClient = (() => client) as unknown as typeof connectionPool.getClient;
afterAll(() => {
    connectionPool.getClient = realGetClient;
    stopHoldRefresh();
});

const panelTask: UpdateTask = {
    type: "local_panel",
    computerId: "local",
    id: "test.server",
    version: "2.0.0",
    name: "Game Server",
    computerName: null,
    sha256: "a".repeat(64),
};

beforeEach(async () => {
    await updateQueue.idle();
    Object.assign(daemon, { pending: [], pendingError: null, running: new Set(), installs: [], stopAndUpdates: [], stopAndUpdateFailure: null });
});

describe("held updates", () => {
    test("a held panel updates once its processes stop, and not before", async () => {
        const key = "panel:local:test.server";
        const [held] = await updateQueue.enqueue({
            items: [{ key, kind: "panel", computerId: "local", computerName: null, panelId: "test.server", name: "Game Server", version: "2.0.0" }],
            run: async () => ({ key, kind: "panel", computerId: "local", computerName: null, id: "test.server", name: "Game Server", version: "2.0.0", sha256: null, users: ["Game Server"] }),
        });
        expect(held.status).toBe("held");
        heldPanels.set(key, { task: panelTask, processes: ["mc"] });

        daemon.running.add("mc");
        await refreshHolds();
        await updateQueue.idle();
        expect(daemon.installs).toEqual([]);
        expect(updateQueue.hold(key)).toBeDefined();

        daemon.running.delete("mc");
        await refreshHolds();
        await updateQueue.idle();
        expect(daemon.installs).toEqual(["test.server"]);
        expect(updateQueue.snapshot().items.find((item) => item.key === key)?.status).toBe("done");
        expect(heldPanels.has(key)).toBe(false);
    });

    test("an update that failed when stopped for without asking is not stopped for again; it waits for Stop and update", async () => {
        daemon.pending = [{ name: "java21", version: "21.0.5", blockedBy: [{ processId: "helper", owner: null, holds: false }] }];
        daemon.stopAndUpdateFailure = "disk full";
        await refreshHolds();
        await updateQueue.idle();
        expect(daemon.stopAndUpdates).toEqual([["java21"]]);
        expect(updateQueue.snapshot().items.find((item) => item.key === "package:local:java21")).toMatchObject({ status: "failed", error: "disk full" });

        await refreshHolds();
        await updateQueue.idle();
        expect(daemon.stopAndUpdates).toEqual([["java21"]]);
        expect(updateQueue.hold("package:local:java21")).toMatchObject({ name: "java21", version: "21.0.5" });
    });
});
