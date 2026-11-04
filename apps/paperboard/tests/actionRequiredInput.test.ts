// An action call that leaves a required input empty is refused before `run`
// (bun test). `required` used to be a hint only the flow editor drew, so an
// empty value reached the panel's run function as "". This registers an
// action through the SDK and calls it through a real daemon.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startPaperCraneServer } from "../papercrane/index";
import { closeTransport, initPaperApi } from "../../../packages/paperapi/src/ipc";
import { actionsApi, defineAction } from "../../../packages/paperapi/src/actions";

const PANEL = "dev.test.requiredinput";
let root = "";
let savedDir: string | undefined;
let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;
const seen: unknown[] = [];

beforeAll(async () => {
    savedDir = process.env.PAPERBOARD_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-required-input-"));
    process.env.PAPERBOARD_DIR = root;
    daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    await initPaperApi();
    await actionsApi.register(
        defineAction({
            id: "send-message",
            name: "Send message",
            description: "Sends a message",
            inputs: {
                channel: { type: "string", label: "Channel ID", required: true },
                tags: { type: "list<string>", label: "Tags", required: true },
                note: { type: "string", label: "Note" },
            },
            run: (_ctx, inputs) => {
                seen.push(inputs);
                return true;
            },
        }),
        undefined,
        PANEL,
    );
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

test("an empty or missing required input is refused, naming the input", async () => {
    await expect(actionsApi.call(PANEL, "send-message", { tags: ["a"] })).rejects.toThrow('"Channel ID" is required');
    await expect(actionsApi.call(PANEL, "send-message", { channel: "", tags: ["a"] })).rejects.toThrow('"Channel ID" is required');
    await expect(actionsApi.call(PANEL, "send-message", { channel: "general", tags: ["", null] })).rejects.toThrow('"Tags" is required');
    expect(seen).toEqual([]);
});

test("a call with every required input runs, and an optional one may stay empty", async () => {
    expect(await actionsApi.call(PANEL, "send-message", { channel: "general", tags: ["a"], note: "" })).toBe(true);
    expect(seen).toEqual([{ channel: "general", tags: ["a"], note: "" }]);
});
