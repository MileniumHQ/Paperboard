import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildTrashRemoveCommand } from "../src/core/trash";

test("world removal retains restorable bytes and refuses to destroy them when staging fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "world-recovery-"));
    try {
        fs.mkdirSync(path.join(root, "world"));
        fs.writeFileSync(path.join(root, "world", "level.dat"), "important world bytes");
        // Static fixture inputs exercise the actual POSIX command used by
        // the service; this is a Linux gate, not a Windows support claim.
        const removed = execFileSync("/bin/sh", ["-c", buildTrashRemoveCommand(["world", "world_nether"], ".trash-1", false)], { cwd: root, encoding: "utf8" });
        expect(removed).toContain("TRASH_REMOVE_OK");
        expect(fs.existsSync(path.join(root, "world"))).toBe(false);
        fs.renameSync(path.join(root, ".trash-1", "world"), path.join(root, "world"));
        expect(fs.readFileSync(path.join(root, "world", "level.dat"), "utf8")).toBe("important world bytes");
        fs.writeFileSync(path.join(root, "blocked"), "cannot stage here");
        const refused = execFileSync("/bin/sh", ["-c", buildTrashRemoveCommand(["world"], "blocked", false)], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        expect(refused).not.toContain("TRASH_REMOVE_OK");
        expect(fs.readFileSync(path.join(root, "world", "level.dat"), "utf8")).toBe("important world bytes");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
