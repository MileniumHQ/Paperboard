// Hermetic test provisioning (bun test preload): every suite gets a throwaway
// PAPERBOARD_DIR with the standard subdirectories, so a test run never reads
// or writes the developer's real ~/.paperboard. The daemon and the SDK
// discover credentials through this directory, so without it a suite on a
// machine with Paperboard live can reach the real daemon, and the logger
// writes into the real log directory.
//
// A suite that needs its own data dir may override PAPERBOARD_DIR, but must
// restore the previous value (see tests/machineid.test.ts for the pattern).
import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-test-"));
for (const dir of [
    "packages",
    "panels",
    "configs",
    "files",
    "local",
    "logs",
    "sockets",
]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
}
process.env.PAPERBOARD_DIR = root;

// bun test fires no process exit handlers, so cleanup runs in a preload
// afterAll, which bun runs once after every test file. Support modules add
// their own teardown (temp dirs, spawned children) through
// registerTestCleanup; it runs first, then the throwaway PAPERBOARD_DIR goes.
const cleanups: Array<() => void | Promise<void>> = [];
(globalThis as { __paperboardTestCleanup?: typeof cleanups }).__paperboardTestCleanup = cleanups;

afterAll(async () => {
    const failures: unknown[] = [];
    for (const cleanup of cleanups.splice(0)) {
        try {
            await cleanup();
        } catch (err) {
            console.error("[test setup] a test cleanup failed:", err);
            failures.push(err);
        }
    }
    fs.rmSync(root, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, "test cleanup failed");
});
