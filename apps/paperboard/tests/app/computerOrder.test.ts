import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConnectionPool } from "../../src/main/communication/papercrane/ConnectionPool";

// The paired computers file holds every pairing's token and pinned
// certificate. Reordering the rail and renaming a computer rewrite it, so
// neither may ever drop a pairing, and a rename of This Computer must
// survive the next launch.

const file = () => path.join(process.env.PAPERBOARD_DIR!, "local", "paired_computers.json");
const remote = (id: string) => ({
    id,
    name: id,
    host: "10.0.0.2",
    port: 45464,
    token: `token-${id}`,
    cert: `cert-${id}`,
    isLocal: false,
});
const stored = () => JSON.parse(fs.readFileSync(file(), "utf8")) as { computers: { id: string; name: string; token?: string }[] };
const ids = (pool: ConnectionPool) => pool.listAll().map((c) => c.id);

// the constructor refreshes the local record asynchronously
async function openPool(): Promise<ConnectionPool> {
    const pool = new ConnectionPool();
    await pool.localRecorded;
    return pool;
}

describe("computer order and names", () => {
    beforeEach(() => {
        fs.writeFileSync(file(), JSON.stringify({ activeId: "local", computers: [{ id: "local", name: "This Computer", host: "127.0.0.1", port: 45464, isLocal: true }, remote("remote-a"), remote("remote-b")] }));
    });
    afterAll(() => fs.rmSync(file(), { force: true }));

    test("a reorder is saved in the new order with every pairing intact", async () => {
        const pool = await openPool();
        pool.reorderComputers(["remote-b", "local", "remote-a"]);
        expect(ids(pool)).toEqual(["remote-b", "local", "remote-a"]);
        expect(stored().computers.map((c) => [c.id, c.token])).toEqual([
            ["remote-b", "token-remote-b"],
            ["local", undefined],
            ["remote-a", "token-remote-a"],
        ]);
        expect(ids(await openPool())).toEqual(["remote-b", "local", "remote-a"]);
    });

    test("This Computer keeps the name it was given across launches", async () => {
        const pool = await openPool();
        expect(pool.renameComputer("local", "  Workstation  ")).toBe(true);
        const reopened = await openPool();
        expect(reopened.getComputer("local")?.name).toBe("Workstation");
        expect(reopened.getComputer("local")?.isLocal).toBe(true);
    });

    test("renaming a paired computer keeps its pairing across launches", async () => {
        const pool = await openPool();
        expect(pool.renameComputer("remote-a", "Game Box")).toBe(true);
        const saved = stored().computers.find((c) => c.id === "remote-a") as Record<string, unknown> | undefined;
        expect(saved).toMatchObject({ name: "Game Box", port: 45464, token: "token-remote-a", cert: "cert-remote-a" });
        const reopened = await openPool();
        expect(reopened.getComputer("remote-a")).toMatchObject({ name: "Game Box", port: 45464, token: "token-remote-a" });
        expect(reopened.renameComputer("local", "Workstation")).toBe(true);
        expect((await openPool()).getComputer("local")?.name).toBe("Workstation");
    });
});
