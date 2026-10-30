// A chatty panel service must not flood the daemon with state syncs (bun test).
//
// Every setState used to send its own actions:emit call. Game Server's
// console calls setState once per log line, so a busy Minecraft server filled
// the transport's 1000-call window and froze with "PaperCrane transport has
// 1000 outstanding calls". State syncs now keep one call in flight and merge
// the rest. This runs a real service against a real daemon and listens to the
// state channel the way a panel bridge does.
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startPaperCraneServer } from "../papercrane/index";

const PANEL = "dev.test.statesync";
let root = "";
let savedDir: string | undefined;
let daemon: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;

beforeAll(async () => {
    savedDir = process.env.PAPERBOARD_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-state-sync-"));
    process.env.PAPERBOARD_DIR = root;
    daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
});

afterAll(async () => {
    try {
        (await import("@mileniumhq/paperapi")).closeTransport("local");
        daemon?.stop();
    } finally {
        if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
        else process.env.PAPERBOARD_DIR = savedDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("thousands of state changes in a burst reach the bridge without exhausting the call window", async () => {
    const { actionsApi, definePanelService, STATE_SYNC_EVENT } = await import("@mileniumhq/paperapi");
    const errors = spyOn(console, "error");
    try {
        const service = definePanelService({ id: PANEL, state: { line: -1, log: [] as string[] } });
        await service.ready;
        let latest = -1;
        let syncs = 0;
        const off = actionsApi.on(PANEL, STATE_SYNC_EVENT, (payload: any) => {
            syncs++;
            if (typeof payload?.state?.line === "number") latest = payload.state.line;
        });
        // the listener's subscription reaches the daemon before the burst
        await new Promise((r) => setTimeout(r, 200));

        const LINES = 5000;
        for (let line = 0; line < LINES; line++) {
            service.setState((prev) => ({ line, log: [...prev.log, `line ${line}`].slice(-200) }));
        }
        const deadline = Date.now() + 15_000;
        while (latest !== LINES - 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
        off();

        const failures = errors.mock.calls.map((args) => args.map(String).join(" "));
        expect(failures.filter((f) => f.includes("outstanding calls"))).toEqual([]);
        expect(latest).toBe(LINES - 1);
        expect(service.getState().log.at(-1)).toBe(`line ${LINES - 1}`);
        // merged, not one call per change
        expect(syncs).toBeLessThan(LINES / 10);
    } finally {
        errors.mockRestore();
    }
}, 30_000);
