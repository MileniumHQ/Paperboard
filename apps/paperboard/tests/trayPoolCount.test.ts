// The tray's running-panel count across paired computers: an offline remote
// runs nothing reachable and is skipped, while a connected computer that
// fails to answer still fails the count (the tray shows it as unavailable).
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";

// TEST-NET addresses with no pinned certificate: the clients refuse to dial,
// so they stay disconnected without touching the network or the real daemon
const paired = {
    computers: [
        { id: "remote-on", name: "On", host: "192.0.2.1", port: 7777, token: "pc_on" },
        { id: "remote-off", name: "Off", host: "192.0.2.2", port: 7777, token: "pc_off" },
    ],
};

function connected(client: PaperCraneClient, count: () => Promise<number>) {
    const status = client.getStatus();
    client.getStatus = () => ({ ...status, connected: true, error: undefined });
    client.runningServiceCount = count;
}

describe("tray running panel count across computers", () => {
    const prev = process.env.PAPERBOARD_DIR;
    let dir = "";
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-tray-pool-"));
        fs.mkdirSync(path.join(dir, "local"), { recursive: true });
        fs.writeFileSync(path.join(dir, "local", "paired_computers.json"), JSON.stringify(paired));
        process.env.PAPERBOARD_DIR = dir;
    });
    afterEach(() => {
        process.env.PAPERBOARD_DIR = prev;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("skips an offline remote and still fails when a connected one cannot answer", async () => {
        const { ConnectionPool } = await import("../src/main/communication/papercrane/ConnectionPool");
        const pool = new ConnectionPool();
        try {
            const on = pool.getClient("remote-on");
            const off = pool.getClient("remote-off");
            expect(off.getStatus()).toMatchObject({ isRemote: true, connected: false });
            off.runningServiceCount = async () => { throw new Error("offline remote was asked"); };

            connected(on, async () => 2);
            expect(await pool.runningServiceCount()).toBe(2);

            connected(on, async () => { throw new Error("count unreadable"); });
            await expect(pool.runningServiceCount()).rejects.toThrow("count unreadable");
        } finally { pool.dispose(); }
    });
});
