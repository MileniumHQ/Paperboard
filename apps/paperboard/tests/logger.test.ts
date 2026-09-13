import { describe, it, expect } from "bun:test";
import { PaperboardLogger } from "../papercrane/logger";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("PaperboardLogger", () => {
    it("writes leveled entries to a log file", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-log-"));
        try {
            const log = new PaperboardLogger({
                name: "test",
                logDir: dir,
                minLevel: "debug",
                mirrorConsole: false,
            });
            log.info("hello", { a: 1 });
            log.error("boom", new Error("kaboom"));
            const content = fs.readFileSync(path.join(dir, "test.log"), "utf8");
            expect(content).toContain("[INFO] [test] hello");
            expect(content).toContain("[ERROR] [test] boom");
            expect(content).toContain("kaboom");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("respects min level", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-log-"));
        try {
            const log = new PaperboardLogger({
                name: "min",
                logDir: dir,
                minLevel: "warn",
                mirrorConsole: false,
            });
            log.debug("nope");
            log.info("nah");
            log.warn("yes");
            const content = fs.readFileSync(path.join(dir, "min.log"), "utf8");
            expect(content).not.toContain("nope");
            expect(content).not.toContain("nah");
            expect(content).toContain("yes");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("never throws when the log dir is unwritable", () => {
        const log = new PaperboardLogger({
            name: "broken",
            logDir: "/proc/definitely-not-writable/pb",
            mirrorConsole: false,
        });
        expect(() => log.info("should not throw")).not.toThrow();
    });
});
