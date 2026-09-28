import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth } from "../papercrane/auth";
import { isAllowedOrigin } from "../papercrane/ws";

let tmp: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-auth-"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PaperCraneAuth pairing", () => {
    it("issues a token for a correct code and persists it", () => {
        const auth = new PaperCraneAuth(false, tmp);
        const code = auth.startPairing();
        expect(code).toMatch(/^\d{6}$/);
        const res = auth.pair(code, "Test Client");
        expect(res.success).toBe(true);
        expect(res.token).toMatch(/^pc_[0-9a-f]{48}$/);
        // Token survives a restart (new instance, same dir)
        const auth2 = new PaperCraneAuth(false, tmp);
        expect(auth2.verifyToken(res.token!)).toBe(true);
    });

    it("locks briefly on first wrong attempt", () => {
        const auth = new PaperCraneAuth(false, tmp);
        auth.startPairing();
        const res = auth.pair("000000");
        expect(res.success).toBe(false);
        expect(res.remainingSeconds).toBe(5);
        // Even the right code is refused while locked
        const code = auth.getPairingCode()!;
        expect(auth.pair(code).success).toBe(false);
    });

    it("escalates lockout after repeated wrong attempts", () => {
        let clock = 1_000_000;
        const now = () => clock;
        const auth = new PaperCraneAuth(false, tmp, now);
        auth.startPairing();
        auth.pair("111111"); // 1st fail — 5s
        clock += 6_000;
        auth.cancelPairing();
        auth.startPairing();
        auth.pair("222222"); // 2nd fail — 5s
        clock += 6_000;
        auth.cancelPairing();
        auth.startPairing();
        const res = auth.pair("333333"); // 3rd fail — escalated
        expect(res.remainingSeconds).toBe(30);
    });

    it("rejects pairing when no pairing session is active", () => {
        const auth = new PaperCraneAuth(false, tmp);
        expect(auth.pair("123456").success).toBe(false);
    });

    it("noAuth mode accepts anything", () => {
        const auth = new PaperCraneAuth(true, tmp);
        expect(auth.verifyToken(undefined)).toBe(true);
        expect(auth.pair("").success).toBe(true);
    });

    it("revocation works and persists", () => {
        const auth = new PaperCraneAuth(false, tmp);
        const code = auth.startPairing();
        const token = auth.pair(code).token!;
        expect(auth.revokeToken(token)).toBe(true);
        const auth2 = new PaperCraneAuth(false, tmp);
        expect(auth2.verifyToken(token)).toBe(false);
    });
});

describe("isAllowedOrigin", () => {
    it("allows localhost and loopback browser origins", () => {
        expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
        expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
    });

    it("allows *.localhost loopback names (browser-mode shell and panels)", () => {
        expect(isAllowedOrigin("http://paperboard.localhost:41234")).toBe(true);
        expect(isAllowedOrigin("http://local.dev.paperboard.terminal.paperboard.localhost:41234")).toBe(true);
    });

    it("rejects lookalike hosts", () => {
        expect(isAllowedOrigin("http://evil-localhost.attacker.com")).toBe(false);
        expect(isAllowedOrigin("http://127.0.0.1.evil.com")).toBe(false);
        expect(isAllowedOrigin("https://localhost.evil.io")).toBe(false);
        expect(isAllowedOrigin("http://evillocalhost")).toBe(false);
        expect(isAllowedOrigin("http://paperboard.localhost.evil.io")).toBe(false);
    });

    it("allows app custom schemes", () => {
        expect(isAllowedOrigin("panel://com.example.terminal")).toBe(true);
        expect(isAllowedOrigin("vscode-webview://webview")).toBe(true);
    });

    it("rejects file:// origins (local HTML must not hold a WS origin)", () => {
        expect(isAllowedOrigin("file://")).toBe(false);
    });

    it("rejects remote http origins", () => {
        expect(isAllowedOrigin("https://attacker.example")).toBe(false);
    });
});
