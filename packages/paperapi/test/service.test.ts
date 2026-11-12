import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "../src/blocks";
import { createPanelBridge } from "../src/bridge";
import { closeTransport } from "../src/ipc";
import { serviceApi } from "../src/serviceCalls";
import { getWidgetChoices } from "../src/widgetChoices";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

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

const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
};

test("the page reads the service's state, calls it, and hears each change and event", async () => {
    const bridge = createPanelBridge<{ items: string[] }>({ panelId: SERVICE, defaultState: { items: [] } });
    try {
        expect(await bridge.refreshState()).toEqual({ items: [] });
        const heard: unknown[] = [];
        const off = bridge.on("item:added", (payload) => heard.push(payload));
        expect(await bridge.call<number>("addItem", { name: "apple" })).toBe(1);
        expect(await bridge.calls.addItem({ name: "pear" })).toBe(2);
        await until(() => bridge.getState().items.length === 2);
        expect(bridge.getState().items).toEqual(["apple", "pear"]);
        await until(() => heard.length === 2);
        expect(heard).toEqual([{ name: "apple", count: 1 }, { name: "pear", count: 2 }]);
        off();
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
