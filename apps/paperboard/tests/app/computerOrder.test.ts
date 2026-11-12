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

// the constructor refreshes the local record asynchronously; init awaits it
async function openPool(): Promise<ConnectionPool> {
    const pool = new ConnectionPool();
    await (pool as unknown as { ensureLocalComputer(): Promise<void> }).ensureLocalComputer();
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

    test("a reorder that leaves out, repeats or invents a computer is refused and changes nothing", async () => {
        const pool = await openPool();
        const before = fs.readFileSync(file(), "utf8");
        for (const bad of [["local", "remote-a"], ["local", "remote-a", "remote-a"], ["local", "remote-a", "remote-c"], ["local", "remote-a", "remote-b", "remote-c"]]) {
            expect(() => pool.reorderComputers(bad)).toThrow("The computer list changed");
        }
        expect(ids(pool)).toEqual(["local", "remote-a", "remote-b"]);
        expect(fs.readFileSync(file(), "utf8")).toBe(before);
    });

    test("This Computer keeps the name it was given across launches", async () => {
        const pool = await openPool();
        expect(pool.updateComputer("local", { name: "  Workstation  " })).toBe(true);
        const reopened = await openPool();
        expect(reopened.getComputer("local")?.name).toBe("Workstation");
        expect(reopened.getComputer("local")?.isLocal).toBe(true);
    });

    test("a blank or overlong name is refused and the old one kept", async () => {
        const pool = await openPool();
        expect(() => pool.updateComputer("remote-a", { name: "   " })).toThrow("A computer needs a name.");
        expect(() => pool.updateComputer("remote-a", { name: "x".repeat(65) })).toThrow("at most 64 characters");
        expect(stored().computers.find((c) => c.id === "remote-a")?.name).toBe("remote-a");
    });
});
