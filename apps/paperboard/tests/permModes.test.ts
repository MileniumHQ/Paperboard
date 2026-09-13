import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth } from "../papercrane/auth";
import { writeJsonAtomicSync } from "../papercrane/storage";

let tmp: string;
let savedDir: string | undefined;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-perms-"));
    savedDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = tmp;
});

afterEach(() => {
    if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedDir;
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("crane.json handshake file permissions", () => {
    it("writes the handshake with owner-only mode 0600 at birth", async () => {
        const { startPaperCraneServer } = await import("../papercrane/index");
        const port = 38000 + Math.floor(Math.random() * 1000);
        const instance = await startPaperCraneServer({
            host: "127.0.0.1",
            port,
            noAuth: true,
            headless: true,
            staticToken: "pc_test_token",
        });
        try {
            const file = path.join(tmp, "local", "crane.json");
            expect(fs.existsSync(file)).toBe(true);
            const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
            expect(parsed.token).toBe("pc_test_token");
            expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        } finally {
            instance.stop();
        }
    });
});

describe("authorized_tokens.json permissions", () => {
    it("persists tokens with mode 0600 at birth (no later chmod window)", () => {
        const auth = new PaperCraneAuth(false, tmp);
        const res = auth.pair(auth.startPairing(), "Perm Test");
        expect(res.success).toBe(true);
        const file = path.join(tmp, "authorized_tokens.json");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it("flushTokenStore persists a throttle-dirty lastSeenAt", () => {
        const auth = new PaperCraneAuth(false, tmp);
        const res = auth.pair(auth.startPairing(), "Dirty Test");
        expect(res.success).toBe(true);
        const file = path.join(tmp, "authorized_tokens.json");
        const before = fs.readFileSync(file, "utf8");

        expect(auth.isTokensDirty).toBe(false);
        expect(auth.verifyToken(res.token!)).toBe(true);
        expect(auth.isTokensDirty).toBe(true);
        // the file is untouched until the throttled flush fires
        expect(fs.readFileSync(file, "utf8")).toBe(before);

        auth.flushTokenStore();
        expect(auth.isTokensDirty).toBe(false);
        const after = JSON.parse(fs.readFileSync(file, "utf8"))[0];
        expect(after.lastSeenAt).toBeTruthy();
    });
});

describe("writeJsonAtomicSync mode option", () => {
    it("applies the requested mode at birth, not chmod-after", () => {
        const file = path.join(tmp, "paired.json");
        writeJsonAtomicSync(file, { computers: [] }, { mode: 0o600 });
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });
});