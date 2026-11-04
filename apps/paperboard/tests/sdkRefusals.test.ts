// terminal.create, terminal.destroy and process.kill reject with the daemon's
// reason (bun test). They used to log the refusal to the console and resolve,
// so a panel that awaited them carried on as if the shell had started or the
// process had stopped. This sends real calls to a real daemon.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startPaperCraneServer } from "../papercrane/index";
import { closeTransport, initPaperApi } from "../../../packages/paperapi/src/ipc";
import { processApi } from "../../../packages/paperapi/src/process";
import { terminalApi } from "../../../packages/paperapi/src/index";

let root = "";
let savedDir: string | undefined;
let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;

beforeAll(async () => {
    savedDir = process.env.PAPERBOARD_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-sdk-refusals-"));
    process.env.PAPERBOARD_DIR = root;
    daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    await initPaperApi();
});

afterAll(() => {
    try {
        closeTransport("local");
        daemon?.stop();
    } finally {
        if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
        else process.env.PAPERBOARD_DIR = savedDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// the daemon refuses ids over 128 characters before it touches anything
const TOO_LONG = "x".repeat(200);

test("terminal.create rejects when the daemon refuses the shell", async () => {
    await expect(terminalApi.create(TOO_LONG)).rejects.toThrow('Parameter "id" exceeds 128 characters');
});

test("terminal.destroy rejects when the daemon refuses", async () => {
    await expect(terminalApi.destroy(TOO_LONG)).rejects.toThrow('Parameter "id" exceeds 128 characters');
});

test("process.kill rejects when the daemon refuses", async () => {
    await expect(processApi.kill(TOO_LONG)).rejects.toThrow('Parameter "id" exceeds 128 characters');
});

test("process.kill of a process that already ended resolves", async () => {
    await expect(processApi.kill("pb-sdk-refusals-gone")).resolves.toBeUndefined();
});
