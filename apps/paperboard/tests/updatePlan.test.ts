// update planning symmetry (bun test): checksum-less panel entries are
// refused at plan time — never planned only to fail at execution.
import { describe, it, expect } from "bun:test";
import { planUpdateTasks, withInstalledRecords, type ComputerUpdateState } from "../src/main/updatePlan";

const SHA = "a".repeat(64);

function localComputer(panels: ComputerUpdateState["panels"]): ComputerUpdateState {
    return {
        id: "local",
        name: "local",
        isLocal: true,
        panels,
        packages: {},
        sysInfo: { os: "linux", arch: "x64" },
    };
}

const OPTS = {
    registryUrl: "https://registry.example",
    readCraneVersion: async () => null,
};

describe("planUpdateTasks panel checksum gate", () => {
    it("plans a checksummed local_panel update", async () => {
        const tasks = await planUpdateTasks(
            [localComputer([{ id: "p1", version: "1.0.0", name: "P1" }])],
            { p1: { version: "1.1.0", sha256: SHA } },
            {},
            {},
            OPTS,
        );
        expect(tasks).toHaveLength(1);
        expect(tasks[0].type).toBe("local_panel");
        expect(tasks[0].sha256).toBe(SHA);
    });

    it("refuses checksum-less local_panel entries at plan time", async () => {
        for (const bad of [undefined, "not-a-hash", ""]) {
            const tasks = await planUpdateTasks(
                [localComputer([{ id: "p1", version: "1.0.0", name: "P1" }])],
                { p1: { version: "1.1.0", sha256: bad } },
                {},
                {},
                OPTS,
            );
            expect(tasks).toHaveLength(0);
        }
    });

    it("still skips dev-linked and up-to-date panels", async () => {
        const tasks = await planUpdateTasks(
            [
                localComputer([
                    { id: "dev", version: "1.0.0", isDevLink: true },
                    { id: "same", version: "1.1.0" },
                ]),
            ],
            {
                dev: { version: "2.0.0", sha256: SHA },
                same: { version: "1.1.0", sha256: SHA },
            },
            {},
            {},
            OPTS,
        );
        expect(tasks).toHaveLength(0);
    });
});

describe("planUpdateTasks crane version gate", () => {
    function remoteComputer(sysInfo: ComputerUpdateState["sysInfo"]): ComputerUpdateState {
        return {
            id: "remote-1",
            name: "remote-1",
            isLocal: false,
            panels: [],
            packages: {},
            sysInfo,
        };
    }

    const craneIndex = {
        "linux-x64": { version: "2.0.0", sha256: SHA, signature: "fixture-signature" },
    };

    it("refuses to plan an unsigned crane update", async () => {
        const tasks = await planUpdateTasks(
            [remoteComputer({ os: "linux", arch: "x64", version: "1.0.0" })],
            {},
            {},
            { "linux-x64": { version: "2.0.0", sha256: SHA } },
            OPTS,
        );
        expect(tasks).toEqual([]);
    });

    it("plans a crane update when the installed version is known and older", async () => {
        const tasks = await planUpdateTasks(
            [remoteComputer({ os: "linux", arch: "x64", version: "1.0.0" })],
            {},
            {},
            craneIndex,
            OPTS,
        );
        expect(tasks).toHaveLength(1);
        expect(tasks[0].type).toBe("ext_crane");
        expect(tasks[0].version).toBe("2.0.0");
    });

    it("refuses to plan a crane update when the installed version is unknown", async () => {
        // no sysInfo version and readCraneVersion returns null: planning
        // anyway would risk a silent downgrade
        const tasks = await planUpdateTasks(
            [remoteComputer({ os: "linux", arch: "x64" })],
            {},
            {},
            craneIndex,
            OPTS,
        );
        expect(tasks).toHaveLength(0);
    });

    it("recovers the version through readCraneVersion when sysInfo lacks it", async () => {
        const tasks = await planUpdateTasks(
            [remoteComputer({ os: "linux", arch: "x64" })],
            {},
            {},
            craneIndex,
            { ...OPTS, readCraneVersion: async () => "1.0.0" },
        );
        expect(tasks).toHaveLength(1);
        expect(tasks[0].type).toBe("ext_crane");
    });

    it("skips the crane update when already up to date", async () => {
        const tasks = await planUpdateTasks(
            [remoteComputer({ os: "linux", arch: "x64", version: "2.0.0" })],
            {},
            {},
            craneIndex,
            OPTS,
        );
        expect(tasks).toHaveLength(0);
    });
});

describe("installed panels the store doesn't list", () => {
    // the registry worker itself, over an in-memory KV, publishing through
    // the operator's own publish
    async function registry() {
        const { default: worker } = await import("../../origami/src/index");
        const { publishPanel } = await import("../../origami/scripts/lib/panelPublish");
        const records = new Map<string, string>([["panels:index", "{}"]]);
        const kv = {
            get: async (key: string, o?: { type?: string }) => {
                const v = records.get(key);
                return v === undefined ? null : o?.type === "json" ? JSON.parse(v) : v;
            },
            list: async (o: { prefix?: string }) => ({
                keys: [...records.keys()].filter((k) => k.startsWith(o.prefix ?? "")).map((name) => ({ name })),
                list_complete: true,
            }),
        };
        const storage = {
            getJson: async <T>(key: string) => (records.has(key) ? (JSON.parse(records.get(key)!) as T) : null),
            putJson: async (key: string, value: unknown) => void records.set(key, JSON.stringify(value)),
            // archives and media go nowhere: only the records matter here
            putObject: async () => undefined,
        };
        const get = async (path: string) => {
            const res = await worker.fetch(new Request(`http://localhost${path}`), { PACKAGES: kv } as never, {} as never);
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
            return (await res.json()) as Record<string, any>;
        };
        const publish = (id: string, version: string, manifest: Record<string, unknown> = {}) =>
            publishPanel(
                { id, name: id, version, signature: "A".repeat(86) + "==", manifest: { id, name: id, version, ...manifest }, archive: new TextEncoder().encode(version) },
                { storage, origin: "http://localhost" },
            );
        const record = async (id: string) => {
            try {
                return await get(`/panel/${id}.json`);
            } catch (err: any) {
                if (err?.status === 404) return null;
                throw err;
            }
        };
        return { get, publish, record };
    }

    it("update from their own registry record", async () => {
        const r = await registry();
        await r.publish("dev.test.old", "0.2.4", { unlisted: true });
        const index = await r.get("/panels/index.json");
        expect(index).toEqual({});
        const computers = [localComputer([{ id: "dev.test.old", version: "0.2.3" }, { id: "dev.test.sideloaded", version: "1.0.0" }])];

        // the index alone plans nothing for it
        expect(await planUpdateTasks(computers, index, {}, {}, OPTS)).toHaveLength(0);

        const { panels, failures } = await withInstalledRecords(computers, index, r.record);
        expect(failures).toBe(0);
        const tasks = await planUpdateTasks(computers, panels, {}, {}, OPTS);
        expect(tasks.map((t) => [t.id, t.version])).toEqual([["dev.test.old", "0.2.4"]]);
    });

    it("count a record they can't read as a failure, and skip dev links", async () => {
        const looked: string[] = [];
        const { failures } = await withInstalledRecords(
            [localComputer([{ id: "p1", version: "1.0.0" }, { id: "dev", version: "1.0.0", isDevLink: true }, { id: "listed", version: "1.0.0" }])],
            { listed: { version: "1.0.0", sha256: SHA } },
            async (id) => {
                looked.push(id);
                throw new Error("registry answered HTTP 500");
            },
        );
        expect(looked).toEqual(["p1"]);
        expect(failures).toBe(1);
    });
});
