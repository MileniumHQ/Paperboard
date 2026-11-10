// Test preload: a throwaway PAPERBOARD_DIR for the whole test process. The
// suite links scaffolded panels and runs a daemon against this folder; it
// must never be the developer's ~/.paperboard.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "create-panel-test-"));
process.env.PAPERBOARD_DIR = dataDir;

afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
});
