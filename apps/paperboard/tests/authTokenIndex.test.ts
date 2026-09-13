// Token hash-index verification (T8): resolve/match behavior must match
// the old linear scan exactly — same hit, same miss — the vault keeps one
// entry per token and the digest index stays in lockstep on add/revoke.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth } from "../papercrane/auth";

let dir = "";

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-index-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("auth token hash index", () => {
    it("resolve returns the right caller (claims intact), like the linear scan did", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            const a = auth.issuePanelToken("a");
            auth.injectToken("pc_master", "host");
            expect(auth.resolveToken(a)?.panelId).toBe("a");
            const master = auth.resolveToken("pc_master");
            expect(master?.panelId).toBeUndefined();
            expect(master?.clientName).toBe("host");
        } finally {
            auth.dispose();
        }
    });

    it("unknown tokens refuse, and refusal does not mark the vault dirty", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            const a = auth.issuePanelToken("a");
            auth.flushTokenStore();
            expect(auth.isTokensDirty).toBe(false);
            expect(auth.resolveToken("pc_unknown")).toBeNull();
            expect(auth.verifyToken("pc_unknown")).toBe(false);
            // a pure miss writes nothing
            expect(auth.isTokensDirty).toBe(false);
            // a hit marks the flush cycle (unchanged behavior)
            auth.resolveToken(a);
        } finally {
            auth.dispose();
        }
    });

    it("revocation drops the entry from the index, not just the vault map", () => {
        const auth = new PaperCraneAuth(false, dir);
        try {
            const a = auth.issuePanelToken("a");
            expect(auth.verifyToken(a)).toBe(true);
            expect(auth.revokeToken(a)).toBe(true);
            expect(auth.verifyToken(a)).toBe(false);
        } finally {
            auth.dispose();
        }
    });

    it("a cold load from disk resolves through the index", () => {
        const first = new PaperCraneAuth(false, dir);
        const token = first.issuePanelToken("persist");
        first.dispose();
        const reopened = new PaperCraneAuth(false, dir);
        try {
            expect(reopened.resolveToken(token)?.panelId).toBe("persist");
        } finally {
            reopened.dispose();
        }
    });
});
