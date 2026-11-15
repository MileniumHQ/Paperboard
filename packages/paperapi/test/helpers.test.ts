// The small helpers every panel reaches for, page and service alike.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorCode, errorMessage } from "../src/errors";
import { writeFileAtomic, writeFileAtomicSync } from "../src/fs";
import { isRecord } from "../src/records";
import { SerialQueue } from "../src/serialQueue";

describe("errorMessage and errorCode", () => {
    test("an Error's own words, anything else as text; a code only when the failure carries one as text", () => {
        expect(errorMessage(new Error("disk full"))).toBe("disk full");
        expect(errorMessage("refused")).toBe("refused");
        expect(errorMessage(undefined)).toBe("undefined");
        expect(errorCode(Object.assign(new Error("no file"), { code: "ENOENT" }))).toBe("ENOENT");
        expect(errorCode(new Error("plain"))).toBeUndefined();
        expect(errorCode({ code: 404 })).toBeUndefined();
        expect(errorCode(null)).toBeUndefined();
    });
});

describe("isRecord", () => {
    test("a plain object passes; null, arrays, class instances and other values don't", () => {
        expect(isRecord({})).toBe(true);
        expect(isRecord(JSON.parse('{"a":1}'))).toBe(true);
        expect(isRecord(Object.create(null))).toBe(true);
        for (const value of [null, undefined, [], [1], new Date(), new Map(), "x", 1, true]) expect(isRecord(value)).toBe(false);
    });
});

// a promise and the function that resolves it
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

describe("SerialQueue", () => {
    test("tasks run one at a time in order, a failure rejects only its own caller, and the next still runs", async () => {
        const queue = new SerialQueue();
        const log: string[] = [];
        const gate = deferred();
        const first = queue.run(async () => {
            log.push("first starts");
            await gate.promise;
            log.push("first ends");
            throw new Error("first failed");
        });
        // passed on detached, as a save queue is
        const run = queue.run;
        const second = run(() => {
            log.push("second runs");
            return 2;
        });
        await Promise.resolve();
        expect(log).toEqual(["first starts"]);
        gate.resolve();
        await expect(first).rejects.toThrow("first failed");
        expect(await second).toBe(2);
        expect(log).toEqual(["first starts", "first ends", "second runs"]);
    });

    test("settled waits for every task queued so far, however each ended", async () => {
        const queue = new SerialQueue();
        const gate = deferred();
        let done = false;
        void queue.run(() => Promise.reject(new Error("refused"))).catch((err) => expect(err.message).toBe("refused"));
        void queue.run(async () => {
            await gate.promise;
            done = true;
        });
        const settled = queue.settled();
        gate.resolve();
        await settled;
        expect(done).toBe(true);
    });
});

describe("writeFileAtomic", () => {
    const dirs: string[] = [];
    const tempDir = () => {
        const dir = mkdtempSync(join(tmpdir(), "paperapi-atomic-"));
        dirs.push(dir);
        return dir;
    };
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    for (const [name, write] of [
        ["async", writeFileAtomic],
        ["sync", async (...args: Parameters<typeof writeFileAtomicSync>) => writeFileAtomicSync(...args)],
    ] as const) {
        test(`${name}: replaces the file whole, makes its folder, and sets the mode asked for exactly`, async () => {
            const dir = tempDir();
            const file = join(dir, "deep", "settings.json");
            await write(file, "old");
            await write(file, new TextEncoder().encode("new"), { mode: 0o100600 });
            expect(readFileSync(file, "utf8")).toBe("new");
            expect(readdirSync(join(dir, "deep"))).toEqual(["settings.json"]);
            if (process.platform !== "win32") expect(statSync(file).mode & 0o7777).toBe(0o600);
        });

        test(`${name}: a write that fails throws its own error and leaves what was there, with no temp file`, async () => {
            const dir = tempDir();
            // a folder in the file's place: the rename over it fails
            const file = join(dir, "taken");
            mkdirSync(file);
            writeFileSync(join(file, "inside"), "kept");
            await expect(write(file, "new")).rejects.toThrow(/EISDIR|ENOTEMPTY|EPERM|EEXIST|EACCES/);
            expect(readdirSync(dir)).toEqual(["taken"]);
            expect(readFileSync(join(file, "inside"), "utf8")).toBe("kept");
        });
    }
});
