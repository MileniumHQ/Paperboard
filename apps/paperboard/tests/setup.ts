// Hermetic test provisioning (bun test preload): every suite gets a throwaway
// PAPERBOARD_DIR with the standard subdirectories, so a test run never reads
// or writes the developer's real ~/.paperboard. The daemon and the SDK
// discover credentials through this directory, so without it a suite on a
// machine with Paperboard live can reach the real daemon, and the logger
// writes into the real log directory.
//
// A suite that needs its own data dir may override PAPERBOARD_DIR, but must
// restore the previous value (see tests/machineid.test.ts for the pattern).
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

process.once("exit", () => {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
        console.error(
            "[test setup] failed to remove throwaway PAPERBOARD_DIR:",
            err,
        );
    }
});
