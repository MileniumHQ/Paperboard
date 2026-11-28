// The computers the app lists are this computer's roster, which its daemon
// owns: the pool reads and writes it through the daemon, and 0.4's own list
// (local/paired_computers.json) is moved into it on the daemon's first start.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import connectionPool, { ConnectionPool } from "../../src/main/communication/papercrane/ConnectionPool";
import { createShellInvokeHandlers } from "../../src/main/communication/shellHandlers";
import { memberIdOf } from "daemon/network/memberId";
import { createTlsIdentity } from "daemon/security/tlsIdentity";
import { dataDir, restoreEnv } from "testkit/fs";
import { TEST_TIMEOUT_MS, within } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const pools: ConnectionPool[] = [];
let previousDir: string | undefined;
afterEach(async () => {
    for (const pool of pools.splice(0)) await closePool(pool);
    restoreEnv("PAPERBOARD_DIR", previousDir);
});

// a pool, and the daemon it starts in this process, as the app's start does
async function openPool(): Promise<ConnectionPool> {
    const pool = new ConnectionPool();
    pools.push(pool);
    await pool.init();
    return pool;
}

// the app quits: its embedded daemon stops with it
async function closePool(pool: ConnectionPool): Promise<void> {
    const index = pools.indexOf(pool);
    if (index >= 0) pools.splice(index, 1);
    const embedded = pool.getClient("local").getEmbeddedServer();
    const closed = embedded ? new Promise<void>((resolve) => embedded.server.once("close", () => resolve())) : Promise.resolve();
    pool.dispose();
    await within("the embedded daemon to stop", closed);
}

const local = () => path.join(process.env.PAPERBOARD_DIR!, "local");
const RACK = "remote-1731000000000-abc123";
const LAPTOP = "remote-1731000000001-def456";

// what 0.4's app wrote: This Computer, renamed, and two paired computers on a refused loopback port
function seedShippedList() {
    previousDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = dataDir();
    const certs = { rack: createTlsIdentity().cert, laptop: createTlsIdentity().cert };
    fs.writeFileSync(path.join(local(), "paired_computers.json"), JSON.stringify({
        activeId: LAPTOP,
        computers: [
            { id: "local", name: "Workstation", host: "127.0.0.1", port: 45464, isLocal: true },
            { id: RACK, name: "Rack", host: "127.0.0.2", port: 1, token: "pc_rack_secret", cert: certs.rack, os: "linux", arch: "x64", isLocal: false },
            { id: LAPTOP, name: "Laptop", host: "127.0.0.3", port: 1, token: "pc_laptop_secret", cert: certs.laptop, os: "darwin", arch: "arm64", isLocal: false },
        ],
    }), { mode: 0o600 });
    return certs;
}

describe("the computer list", () => {
    // Inventory: Data loss — every computer 0.4 paired is listed after the update, under the id 0.4 gave it.
    test("0.4's paired computers are listed as they were, under the ids 0.4 gave them, with the selection it kept", async () => {
        const certs = seedShippedList();
        const pool = await openPool();
        expect(pool.listComputers().map((c) => [c.id, c.name, c.host, c.port, c.isLocal])).toEqual([
            ["local", "Workstation", "127.0.0.1", 45464, true],
            [RACK, "Rack", "127.0.0.2", 1, false],
            [LAPTOP, "Laptop", "127.0.0.3", 1, false],
        ]);
        expect(pool.getActiveId()).toBe(LAPTOP);
        expect(fs.existsSync(path.join(local(), "paired_computers.json"))).toBe(false);
        // the key's id names the same computer
        expect(pool.resolve(memberIdOf(certs.rack))).toBe(RACK);
        expect(pool.getComputer(memberIdOf(certs.laptop))?.token).toBe("pc_laptop_secret");
        // the selection outlives the old file it was read from
        await closePool(pool);
        expect((await openPool()).getActiveId()).toBe(LAPTOP);
    });

    // Inventory: Security — the shell's computer list never carries a pairing's token or pinned certificate.
    test("the computer list the shell gets has no paired computer's token or certificate", async () => {
        seedShippedList();
        const pool = await openPool();
        const computers = pool.listComputers() as unknown as Record<string, unknown>[];
        expect(computers.map((c) => c.id)).toEqual(["local", RACK, LAPTOP]);
        expect(JSON.stringify(computers)).not.toContain("secret");
        expect(computers.every((c) => !("token" in c) && !("cert" in c) && !("memberId" in c))).toBe(true);
    });

    test("a reorder, a rename and the selection stick across a restart, with every pairing intact", async () => {
        seedShippedList();
        const pool = await openPool();
        await pool.reorderComputers([LAPTOP, "local", RACK]);
        expect(await pool.renameComputer("local", "  Desk  ")).toBe(true);
        expect(await pool.renameComputer(RACK, "Game Box")).toBe(true);
        expect(pool.setActive(RACK)).toBe(true);
        await expect(pool.reorderComputers([LAPTOP, "local"])).rejects.toThrow("changed while you were reordering");
        await closePool(pool);

        const reopened = await openPool();
        expect(reopened.listComputers().map((c) => [c.id, c.name])).toEqual([[LAPTOP, "Laptop"], ["local", "Desk"], [RACK, "Game Box"]]);
        expect(reopened.getActiveId()).toBe(RACK);
        expect(reopened.getComputer(RACK)?.token).toBe("pc_rack_secret");
        // the records every computer may be given hold no token and no id 0.4 gave
        const network = path.join(local(), "network");
        const stored = fs.readdirSync(network, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(network, f)).isFile());
        expect(stored.length).toBeGreaterThan(0);
        for (const file of stored) {
            const bytes = fs.readFileSync(path.join(network, file), "utf8");
            expect(bytes).not.toContain("secret");
            expect(bytes).not.toContain(RACK);
        }
    });

    test("a computer forgotten without telling it is gone across a restart, and the selection goes back to this computer", async () => {
        seedShippedList();
        const pool = await openPool();
        pool.setActive(LAPTOP);
        expect(await pool.unpairComputer(LAPTOP, true)).toBeNull();
        expect(pool.getActiveId()).toBe("local");
        await expect(pool.unpairComputer("local")).rejects.toThrow("can't be forgotten");
        await closePool(pool);
        const reopened = await openPool();
        expect(reopened.listComputers().map((c) => c.id)).toEqual(["local", RACK]);
        expect(reopened.resolve(LAPTOP)).toBeNull();
    });
});

// Inventory: Security — pairing answers the shell with the computer's id alone, never its token or certificate.
test("pairing a computer answers the shell with its id and nothing else", async () => {
    const original = connectionPool.pairComputer.bind(connectionPool);
    connectionPool.pairComputer = async () => ({
        id: "paired-1",
        memberId: "paired-1",
        name: "Workshop",
        host: "127.0.0.2",
        port: 45464,
        token: "secret-token",
        cert: "secret-cert",
        isLocal: false,
    });
    try {
        const handlers = createShellInvokeHandlers({
            appVersion: () => "0.0.0",
            launchOptions: () => ({ mobile: false }),
            graphics: () => ({ gpu: true }),
            openPath: async () => "",
            appSettingsChanged: async () => null,
            sendIssue: async () => undefined,
        });
        const answer = await handlers["computer-pair"]({ host: "127.0.0.2", port: 45464, code: "123456" }, undefined);
        expect(answer).toEqual({ id: "paired-1" });
    } finally {
        connectionPool.pairComputer = original;
    }
});
