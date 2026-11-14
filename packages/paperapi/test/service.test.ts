import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "../src/blocks";
import { createPanelBridge } from "../src/bridge";
import { closeTransport, getTransport } from "../src/ipc";
import { serviceApi } from "../src/serviceCalls";
import { getWidgetChoices } from "../src/widgetChoices";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

const FRAME_SCRIPT = join(import.meta.dir, "helpers", "panelFrame.ts");

setDefaultTimeout(60_000);

// a panel's page and its service talk over internal blocks, through the
// real daemon: this test process is the page (the host, as the shell is)
const SERVICE = "dev.test.service";
const OTHER = "dev.test.caller";
let daemon: Daemon;
let panels: PanelProcess[] = [];

beforeAll(async () => {
    daemon = await startDaemon();
    panels = [await daemon.startPanel(SERVICE, "service"), await daemon.startPanel(OTHER, "caller")];
});

afterAll(async () => {
    for (const panel of panels) await panel.stop();
    closeTransport();
    await daemon.stop();
});

test("the page reads the service's state, calls it, and hears each change and event", async () => {
    const bridge = createPanelBridge<{ items: string[] }>({ panelId: SERVICE, defaultState: { items: [] } });
    try {
        expect(await bridge.refreshState()).toEqual({ items: [] });
        const heard: unknown[] = [];
        // wakes whoever waits for the next state patch or event
        let woke = () => {};
        const until = async (check: () => boolean) => {
            while (!check()) await new Promise<void>((resolve) => (woke = resolve));
        };
        const offState = bridge.onStateChange(() => woke());
        const off = bridge.on("item:added", (payload) => {
            heard.push(payload);
            woke();
        });
        await getTransport().subscriptionsSettled();
        expect(await bridge.call<number>("addItem", { name: "apple" })).toBe(1);
        expect(await bridge.calls.addItem({ name: "pear" })).toBe(2);
        await until(() => bridge.getState().items.length === 2 && heard.length === 2);
        expect(bridge.getState().items).toEqual(["apple", "pear"]);
        expect(heard).toEqual([{ name: "apple", count: 1 }, { name: "pear", count: 2 }]);
        off();
        offState();
    } finally {
        bridge.dispose();
    }
});

test("a call that gives nothing back answers null, and one that throws fails with its message", async () => {
    expect(await serviceApi.call(SERVICE, "forget")).toBeNull();
    await expect(serviceApi.call(SERVICE, "fail")).rejects.toThrow("the service said no");
    await expect(serviceApi.call(SERVICE, "missing")).rejects.toThrow();
});

test("Home asks a widget option's choices from the service", async () => {
    await serviceApi.call(SERVICE, "addItem", { name: "plum" });
    const choices = await getWidgetChoices("", SERVICE, "pinned", "item");
    expect(choices.map((c) => c.value)).toContain("plum");
    await expect(getWidgetChoices("", SERVICE, "pinned", "nope")).rejects.toThrow('no choices for widget "pinned" option "nope"');
});

test("none of it is listed, and another panel is refused the service's calls", async () => {
    expect(await blocksApi.list(SERVICE)).toEqual([]);
    const answer = await blocksApi.run<string>(OTHER, "reach-call", { panel: SERVICE });
    expect(answer.startsWith("refused: ")).toBe(true);
    expect(answer).toContain(`internal to panel "${SERVICE}"`);
});

test("a service whose start fails ends with the reason, so the daemon hears it at once", async () => {
    const child = daemon.spawnService("dev.test.broken", "brokenInit");
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.once("exit", (exitCode) => resolve(exitCode)));
    expect(code).toBe(1);
    expect(stderr).toContain("the config file is unreadable");
});

// the shell's readiness challenge, answered by the panel's page in its frame
async function challenge(panelId: string, messages: Record<string, unknown>[]): Promise<unknown[]> {
    const page = spawn(process.execPath, [FRAME_SCRIPT], {
        env: { ...process.env, FRAME_PORT: String(daemon.port), FRAME_TOKEN: daemon.panelToken(panelId), FRAME_PANEL_ID: panelId },
        stdio: ["pipe", "pipe", "pipe"],
    });
    const answers: unknown[] = [];
    let out = "";
    let err = "";
    page.stderr!.on("data", (chunk: Buffer) => {
        err += chunk.toString();
    });
    try {
        for (const message of messages) {
            const answered = new Promise<void>((resolve, reject) => {
                const onData = (chunk: Buffer) => {
                    out += chunk.toString();
                    const end = out.indexOf("\n");
                    if (end === -1) return;
                    answers.push(JSON.parse(out.slice(0, end)));
                    out = out.slice(end + 1);
                    page.stdout!.off("data", onData);
                    resolve();
                };
                page.stdout!.on("data", onData);
                page.once("exit", (code) => reject(new Error(`the page exited ${code}\n${err}`)));
            });
            page.stdin!.write(`${JSON.stringify(message)}\n`);
            await answered;
        }
    } finally {
        page.kill();
    }
    return answers;
}

test("a page answers the shell's challenge ready once its service answers, and failed with the reason when it can't", async () => {
    expect(await challenge(SERVICE, [{ type: "paperboard:initialize", generation: "g1" }])).toEqual([
        { type: "paperboard:ready", generation: "g1", panelId: SERVICE },
    ]);
    // a panel the shell says has no service proves its connection; one whose
    // service never registered fails, naming why
    const [none, missing] = await challenge("dev.test.unserved", [
        { type: "paperboard:initialize", generation: "g2", service: false },
        { type: "paperboard:initialize", generation: "g3" },
    ]);
    expect(none).toEqual({ type: "paperboard:ready", generation: "g2", panelId: "dev.test.unserved" });
    expect(missing).toMatchObject({ type: "paperboard:failed", generation: "g3" });
    expect((missing as { message: string }).message).toContain("value.panel-state");
});
