// Test preload: a throwaway PAPERBOARD_DIR for the whole test process, so no
// suite reads the developer's ~/.paperboard or finds the live daemon's
// handshake there. Suites that run a daemon run it on this folder.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "paperapi-test-"));
mkdirSync(join(dataDir, "local"), { recursive: true });
process.env.PAPERBOARD_DIR = dataDir;
// a service boot context or registry override inherited from the shell that
// started the tests would decide who the SDK thinks it is, or where it reads
for (const name of ["PAPERBOARD_PANEL_ID", "PAPERCRANE_PANEL_TOKEN", "PAPERCRANE_PORT", "PAPERCRANE_TOKEN", "ORIGAMI_REGISTRY_URL"]) {
    delete process.env[name];
}

afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
});
