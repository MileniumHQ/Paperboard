// The pairing code mints a host token, so it must travel through the same
// constant-time compare as every other credential (source grep: the only
// plain !== left on a credential path was the pairing code; it is gone).
// Behavioral proof: a wrong code locks, the right code pairs, and correct
// input survives whitespace.
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth } from "../papercrane/auth";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function freshAuth(now?: () => number): PaperCraneAuth {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-code-"));
    dirs.push(dir);
    return new PaperCraneAuth(false, dir, now);
}

describe("pairing code credential", () => {
    it("pairs with the issued code, including spaced input, and issues a host token", () => {
        const auth = freshAuth();
        try {
            const code = auth.startPairing();
            const digits = code.replace(/\s+/g, "");
            const spaced = digits.split("").join(" ");
            const result = auth.pair(spaced, "test device");
            expect(result.success).toBe(true);
            expect(typeof result.token).toBe("string");
            expect(auth.verifyToken(result.token as string)).toBe(true);
        } finally {
            auth.dispose();
        }
    });

    it("refuses a wrong code and locks subsequent attempts", () => {
        const auth = freshAuth();
        try {
            const code = auth.startPairing().replace(/\s+/g, "");
            // every digit flipped, so the wrong code never coincides with
            // the real one
            const wrong = auth.pair(code.split("").map((d) => (d === "0" ? "1" : "0")).join(""));
            expect(wrong.success).toBe(false);
            expect(wrong.error).toMatch(/Invalid pairing code/);
            // the lockout, not a second guess chance
            expect(auth.pair(code).error).toMatch(/locked/);
        } finally {
            auth.dispose();
        }
    });

    // The former test expected a single peer to cancel the whole session.
    // That was the availability defect: exhaust only that peer's budget.
    it("caps a peer's guesses without cancelling another device's pairing", () => {
        let clock = 0;
        const auth = freshAuth(() => clock);
        const ended: string[] = [];
        auth.on("pairingCancelled", (reason: string) => ended.push(reason));
        try {
            const code = auth.startPairing().replace(/\s+/g, "");
            const wrong = code.split("").map((d) => (d === "0" ? "1" : "0")).join("");
            for (let i = 0; i < 10; i++) {
                expect(auth.pair(wrong, undefined, "192.0.2.1").error).toMatch(/Invalid pairing code/);
                clock += 60_000;
            }
            expect(auth.pair(wrong, undefined, "192.0.2.1").error).toMatch(/Too many wrong pairing codes from this address/);
            expect(ended).toEqual([]);
            expect(auth.isPairingActive()).toBe(true);
            expect(auth.pair(code, undefined, "192.0.2.2").success).toBe(true);
        } finally {
            auth.dispose();
        }
    });
});
