// Unreadable state is quarantined, never read as empty and overwritten, and
// a save that failed is reported, not logged away (bun test).
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth } from "../papercrane/auth";
import { CredentialStore } from "../papercrane/credentials";
import { startPaperCraneServer } from "../papercrane/index";

let dir = "";
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-quarantine-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const quarantined = (folder: string, name: string) =>
    fs.readdirSync(folder).filter((f) => f.startsWith(`${name}.corrupt-`));

describe("paired token store", () => {
    it("a corrupt store keeps its bytes instead of being overwritten by the next save", () => {
        const file = path.join(dir, "authorized_tokens.json");
        const damaged = '[{"token":"pc_paired_phone","clientName":"Phone"'; // truncated write
        fs.writeFileSync(file, damaged);
        const auth = new PaperCraneAuth(false, dir);
        try {
            auth.injectToken("pc_host", "host"); // the save that used to erase it
            const kept = quarantined(dir, "authorized_tokens.json");
            expect(kept).toHaveLength(1);
            expect(fs.readFileSync(path.join(dir, kept[0]), "utf8")).toBe(damaged);
        } finally { auth.dispose(); }
    });

    it("a store that exists but cannot be read refuses to start rather than read as empty", () => {
        if (process.platform === "win32" || process.getuid?.() === 0) return;
        const file = path.join(dir, "authorized_tokens.json");
        fs.writeFileSync(file, "[]");
        fs.chmodSync(file, 0o000);
        try {
            expect(() => new PaperCraneAuth(false, dir)).toThrow();
        } finally { fs.chmodSync(file, 0o600); }
    });
});

describe("vault shares the same reader", () => {
    it("quarantines a corrupt vault", () => {
        fs.mkdirSync(path.join(dir, "local"));
        fs.writeFileSync(path.join(dir, "local", "secrets.json"), "{oops");
        const store = new CredentialStore(dir);
        expect(store.list("panel.a")).toEqual([]);
        expect(quarantined(path.join(dir, "local"), "secrets.json")).toHaveLength(1);
    });
});

describe("paired computers", () => {
    const prev = process.env.PAPERBOARD_DIR;
    beforeEach(() => {
        process.env.PAPERBOARD_DIR = dir;
        fs.mkdirSync(path.join(dir, "local"), { recursive: true });
    });
    afterEach(() => { process.env.PAPERBOARD_DIR = prev; });

    it("a corrupt registry of paired computers is quarantined, not dropped", async () => {
        const file = path.join(dir, "local", "paired_computers.json");
        fs.writeFileSync(file, '{"computers":[{"id":"remote-1","token":"pc_remote"');
        const { ConnectionPool } = await import("../src/main/communication/papercrane/ConnectionPool");
        const pool = new ConnectionPool();
        try {
            expect(quarantined(path.join(dir, "local"), "paired_computers.json")).toHaveLength(1);
        } finally { pool.dispose(); }
    });

    it("readRemotes reads through the shared quarantine reader: pairing state is never read as empty", async () => {
        if (process.platform === "win32" || process.getuid?.() === 0) return;
        const { readRemotes } = await import("../papercrane/remotes");
        const file = path.join(dir, "local", "paired_computers.json");
        // unreadable, not unfound: that is a refusal, not "no pairings"
        fs.writeFileSync(file, JSON.stringify({ computers: [] }));
        fs.chmodSync(file, 0o000);
        try {
            expect(() => readRemotes(file)).toThrow();
        } finally { fs.chmodSync(file, 0o600); }
        // corrupt bytes are quarantined beside the file, and the refusal
        // keeps the bytes recoverable
        fs.writeFileSync(file, '{"computers":[{"id":"remote-1"');
        readRemotes(file);
        expect(quarantined(path.join(dir, "local"), "paired_computers.json")).toHaveLength(1);
    });

    it("a rename that could not be saved is reported and not kept in memory", async () => {
        if (process.platform === "win32" || process.getuid?.() === 0) return;
        const { ConnectionPool } = await import("../src/main/communication/papercrane/ConnectionPool");
        fs.writeFileSync(path.join(dir, "local", "paired_computers.json"), JSON.stringify({
            computers: [{ id: "remote-1", name: "Old", host: "10.0.0.2", port: 45464, token: "pc_x", cert: "c" }],
        }));
        const pool = new ConnectionPool();
        fs.chmodSync(path.join(dir, "local"), 0o500);
        try {
            expect(() => pool.updateComputer("remote-1", { name: "New" })).toThrow();
            expect(pool.getComputer("remote-1")?.name).toBe("Old");
        } finally {
            fs.chmodSync(path.join(dir, "local"), 0o700);
            pool.dispose();
        }
    });
});

describe("daemon handshake", () => {
    it("a daemon that cannot write crane.json fails to start instead of running unreachable", async () => {
        const prev = process.env.PAPERBOARD_DIR;
        process.env.PAPERBOARD_DIR = dir;
        // a directory where the handshake file goes: the atomic rename fails
        fs.mkdirSync(path.join(dir, "local", "crane.json", "blocker"), { recursive: true });
        try {
            await expect(
                startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false }),
            ).rejects.toThrow();
        } finally { process.env.PAPERBOARD_DIR = prev; }
    });
});
