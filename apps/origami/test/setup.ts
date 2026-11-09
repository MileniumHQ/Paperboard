// Hermetic test provisioning (bun test preload): a throwaway PAPERBOARD_DIR,
// set before any test file imports papercrane's logger.
import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "origami-test-"));
process.env.PAPERBOARD_DIR = root;

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});
