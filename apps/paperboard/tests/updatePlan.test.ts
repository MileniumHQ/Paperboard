// update planning symmetry (bun test): checksum-less panel entries are
// refused at plan time — never planned only to fail at execution.
import { describe, it, expect } from "bun:test";
import { planUpdateTasks, type ComputerUpdateState } from "../src/main/updatePlan";

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
