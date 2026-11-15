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

    test("a blank or overlong name is refused with why and the old one kept", async () => {
        const pool = await openPool();
        expect(() => pool.renameComputer("remote-a", "   ")).toThrow("A computer needs a name.");
        expect(() => pool.renameComputer("remote-a", "x".repeat(65))).toThrow("at most 64 characters");
        expect(() => pool.renameComputer("remote-a", 7)).toThrow("A computer name must be text.");
        expect(stored().computers.find((c) => c.id === "remote-a")).toMatchObject({ name: "remote-a", port: 45464 });
    });

    // a pairing saved with a port the next launch can't read is lost then
    test("a pairing with a port that isn't one, or a blank or overlong name, is refused with why before anything is dialed", async () => {
        const pool = await openPool();
        const before = fs.readFileSync(file(), "utf8");
        // ::1 is dialed as a pinned remote; nothing listens on port 1
        for (const port of [70000, 0, "abc", 1.5]) {
            await expect(pool.pairComputer("::1", port, "123456")).rejects.toThrow("That isn't a valid port");
        }
        await expect(pool.pairComputer("::1", 1, "123456", "   ")).rejects.toThrow("A computer needs a name.");
        await expect(pool.pairComputer("::1", 1, "123456", "x".repeat(65))).rejects.toThrow("at most 64 characters");
        await expect(pool.pairComputer("not a host!", 1, "123456")).rejects.toThrow("That isn't a valid address");
        expect(fs.readFileSync(file(), "utf8")).toBe(before);
        expect(ids(pool)).toEqual(["local", "remote-a", "remote-b"]);
    });
});
