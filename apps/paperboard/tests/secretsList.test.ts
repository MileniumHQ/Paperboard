// secretsApi.list resolves with the names the panel set (bun test). The
// vault keys each secret by "<panelId>/<name>" and list used to hand those
// keys out, so a panel got "dev.test.secretslist/apiKey" back for "apiKey".
// This sets and lists through the SDK against a real daemon.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startPaperCraneServer } from "../papercrane/index";
import { closeTransport, initPaperApi } from "../../../packages/paperapi/src/ipc";
import { secretsApi } from "../../../packages/paperapi/src/secrets";

const PANEL = "dev.test.secretslist";
let root = "";
let savedDir: string | undefined;
let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;

beforeAll(async () => {
    savedDir = process.env.PAPERBOARD_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-secrets-list-"));
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

test("list resolves with the names the panel set, sorted, and only its own", async () => {
    await secretsApi.set("token", "one", PANEL);
    await secretsApi.set("apiKey", "two", PANEL);
    await secretsApi.set("other", "three", `${PANEL}.other`);
    expect(await secretsApi.list(PANEL)).toEqual(["apiKey", "token"]);
    // each listed name reads back with get
    for (const name of await secretsApi.list(PANEL)) {
        expect((await secretsApi.get(name, PANEL)).found).toBe(true);
    }
});
