// The computer list and pairing answers the shell gets: never a paired
// computer's token or pinned certificate.
import { afterAll, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import connectionPool, { ConnectionPool } from "../../src/main/communication/papercrane/ConnectionPool";
import { createShellInvokeHandlers } from "../../src/main/communication/shellHandlers";

const file = () => path.join(process.env.PAPERBOARD_DIR!, "local", "paired_computers.json");

beforeEach(() => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(
        file(),
        JSON.stringify({
            activeId: "local",
            computers: [
                { id: "local", name: "This Computer", host: "127.0.0.1", port: 45464, isLocal: true },
                { id: "workshop", name: "Workshop", host: "127.0.0.2", port: 45464, token: "secret-token", cert: "-----BEGIN CERTIFICATE-----\nsecret\n-----END CERTIFICATE-----", isLocal: false },
            ],
        }),
    );
});

afterAll(() => fs.rmSync(file(), { force: true }));

// Inventory: Security — the shell's computer list never carries a pairing's token or pinned certificate.
test("the computer list the shell gets has no paired computer's token or certificate", async () => {
    const pool = new ConnectionPool();
    await pool.localRecorded;
    const computers = pool.listComputers() as unknown as Record<string, unknown>[];
    const paired = computers.find((c) => c.id === "workshop");
    expect(paired?.host).toBe("127.0.0.2");
    expect(computers.every((c) => !("token" in c) && !("cert" in c))).toBe(true);
});

// Inventory: Security — pairing answers the shell with the computer's id alone, never its token or certificate.
test("pairing a computer answers the shell with its id and nothing else", async () => {
    const original = connectionPool.pairComputer.bind(connectionPool);
    (connectionPool as any).pairComputer = async () => ({
        id: "paired-1",
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
        });
        const answer = await handlers["computer-pair"]({ host: "127.0.0.2", port: 45464, code: "123456", name: "Workshop" }, undefined);
        expect(answer).toEqual({ id: "paired-1" });
    } finally {
        (connectionPool as any).pairComputer = original;
    }
});
