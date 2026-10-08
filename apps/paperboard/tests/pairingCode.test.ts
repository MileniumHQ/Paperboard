// The pairing code mints a host token, so it must travel through the same
// constant-time compare as every other credential (source grep: the only
// plain !== left on a credential path was the pairing code; it is gone).
// Behavioral proof: a wrong code locks, the right code pairs, and correct
// input survives whitespace.
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneAuth, MAX_PAIRING_FAILURES } from "../papercrane/auth";

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

    it("ends the pairing session after too many wrong codes, so the code cannot be walked", () => {
        let clock = 0;
        const auth = freshAuth(() => clock);
        const ended: string[] = [];
        auth.on("pairingCancelled", (reason: string) => ended.push(reason));
        try {
            const code = auth.startPairing().replace(/\s+/g, "");
            const wrong = code.split("").map((d) => (d === "0" ? "1" : "0")).join("");
            for (let i = 1; i < MAX_PAIRING_FAILURES; i++) {
                expect(auth.pair(wrong).error).toMatch(/Invalid pairing code/);
                clock += 60_000; // past every lockout
            }
            expect(auth.pair(wrong).error).toMatch(/Pairing has ended/);
            expect(ended).toEqual(["too-many-failures"]);
            expect(auth.isPairingActive()).toBe(false);
            clock += 60_000;
            // the walked code is dead even when guessed right
            expect(auth.pair(code).success).toBe(false);
            // a new session issues a fresh budget
            clock += 60_000;
            const next = auth.startPairing().replace(/\s+/g, "");
            expect(auth.pair(next).success).toBe(true);
        } finally {
            auth.dispose();
        }
    });
});
