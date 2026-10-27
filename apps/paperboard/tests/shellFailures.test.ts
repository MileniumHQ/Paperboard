// The shell's own failures show themselves with their reason instead of
// only reaching the log: App Settings that can't load or save once the local
// PaperCrane goes down, a folder the file manager won't open, nearby
// computers that can't be listed. Real components, hooks and paperapi
// transport on real PaperUI in headless Chrome, against a real PaperCrane.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { startPaperCraneServer } from "../papercrane/index";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import connectionPool from "../src/main/communication/papercrane/ConnectionPool";
import { createShellInvokeHandlers } from "../src/main/communication/shellHandlers";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
if (!chrome) console.warn("shellFailures: skipped, no Chrome found (set PAPERBOARD_CHROME)");

let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;
let client: PaperCraneClient;
let restoreClient: (() => void) | undefined;

beforeAll(async () => {
    daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    client = new PaperCraneClient();
    // main's own client for "local", so crane-credentials answers as it does in the app
    const selection = spyOn(connectionPool, "getClient").mockImplementation(() => client);
    restoreClient = () => selection.mockRestore();
    await client.connect("127.0.0.1");
});

afterAll(() => {
    restoreClient?.();
    client?.disconnect();
    daemon?.stop();
});

describe.skipIf(!chrome)("shell failures", () => {
    test("each shows itself with its reason", async () => {
        const handlers = createShellInvokeHandlers({
            appVersion: () => "0.0.0-test",
            launchOptions: () => ({ firstOpenTutorials: false, mobile: false }),
            openPath: async () => "",
        });
        const credentials = handlers["crane-credentials"](undefined);
        const page = `tests/fixtures/shellFailures/index.html?crane=${encodeURIComponent(JSON.stringify(credentials))}`;
        const { checks, error } = await runBrowserFixture(chrome!, page, async (name) => {
            if (name !== "crane-down") throw new Error(`unknown control ${name}`);
            client.disconnect();
            daemon?.stop();
            daemon = undefined;
        });
        expect(error).toBe("");
        expect(checks).toEqual({
            loadedWhileUp: true,
            noFailureWhileUp: true,
            loadShown: true,
            loadReason: expect.stringContaining("These are the defaults, not your settings: "),
            loadRetry: true,
            loadStillShownAfterFailedRetry: true,
            loadDismissed: true,
            saveShown: true,
            saveReason: expect.stringContaining("Your change was not kept: "),
            saveNotApplied: true,
            switchShowsKeptValue: true,
            folderShown: true,
            folderReason: "No application is registered as handling this file",
            folderRefusalReason: "Invalid parameter: panelId",
            discoveryShown: true,
            discoveryReason: true,
        });
    }, 90_000);
});
