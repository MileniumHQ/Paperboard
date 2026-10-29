// Build with sliders.vite.ts and open /test/fixtures/sliders.html. The real Advanced tab: dragging
// the Memory, Render Distance and Simulation Distance sliders moves the value live and stores it
// only once the drag ends. Pointer events are dispatched by hand, so pointer capture is stubbed.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi, fileApi } from "@mileniumhq/paperapi";

let properties = "view-distance=12\nmotd=hello\n";
const writes: string[] = [];
const calls: { id: string; args: any }[] = [];
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, id: string, args: unknown) => {
    calls.push({ id, args });
    return {};
}) as typeof actionsApi.call;
fileApi.read = async (path: string) => (path === "server.properties" ? properties : null);
fileApi.write = (async (path: string, content: string) => {
    if (path === "server.properties") {
        properties = content;
        writes.push(content);
    }
}) as typeof fileApi.write;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const { setServerVersion } = await import("../../src/lib/server");
const { default: Advanced } = await import("../../src/components/Advanced");
setServerVersion("1.21.4");

const root = document.getElementById("app")!;
let dispose = () => {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (predicate: () => boolean, what: string) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await sleep(20);
    }
    throw new Error(`Timed out waiting for ${what}: ${root.textContent}`);
};
const assert = (value: unknown, label: string) => {
    if (!value) throw new Error(label);
};
const slider = (name: string) => root.querySelector<HTMLElement>(`[role="slider"][aria-label="${name}"]`)!;
const pointer = (el: HTMLElement, type: string, fraction: number) => {
    const track = el.querySelector<HTMLElement>("div:not([aria-hidden])")!;
    const r = track.getBoundingClientRect();
    assert(r.width > 0, "the slider track must have a width inside the settings row");
    el.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: r.left + r.width * fraction,
            clientY: r.top,
        }),
    );
};
const drag = async (name: string, fraction: number, pause: () => Promise<void>) => {
    const el = slider(name);
    pointer(el, "pointerdown", 0.1);
    pointer(el, "pointermove", fraction);
    await pause();
    pointer(el, "pointerup", fraction);
};

try {
    dispose = render(() => <PaperProvider><Advanced /></PaperProvider>, root);
    await wait(() => slider("Render Distance") !== null && slider("Simulation Distance") !== null, "the sliders");
    assert(slider("Render Distance").getAttribute("aria-valuenow") === "12", "render distance reads the stored 12");
    assert(slider("Simulation Distance").getAttribute("aria-valuenow") === "10", "simulation distance starts at the default");
    assert(slider("Render Distance").getAttribute("aria-valuetext") === "12 chunks", "values read in chunks");
    assert(slider("Memory Allocation").getAttribute("aria-valuetext") === "4 GB", "memory reads in GB");

    // dragging: the value follows the pointer, nothing is stored yet
    await drag("Render Distance", 1, async () => {
        assert(slider("Render Distance").getAttribute("aria-valuenow") === "32", "the drag moves the value live");
        await sleep(600);
        assert(writes.length === 0, "nothing is written while the drag is still down");
    });
    await wait(() => writes.length === 1, "the debounced write");
    assert(/view-distance=32/.test(properties), `render distance stored: ${properties}`);
    assert(/motd=hello/.test(properties), "other keys survive the write");
    assert(slider("Render Distance").getAttribute("aria-valuenow") === "32", "the stored value stays after the drag");

    await drag("Simulation Distance", 0, async () => {});
    await wait(() => writes.length === 2, "the second write");
    assert(/simulation-distance=2\b/.test(properties), `simulation distance stored at its minimum: ${properties}`);

    // memory: persisted through the panel config once, when the drag ends
    await drag("Memory Allocation", 1, async () => {
        assert(slider("Memory Allocation").getAttribute("aria-valuenow") === "16", "the memory drag moves live");
        await sleep(50);
        assert(!calls.some((c) => c.id.includes("onfig") && c.args?.patch), "memory is not stored mid-drag");
    });
    await wait(() => calls.some((c) => c.args?.patch?.ramGB === 16), "memory to be stored");
    assert(calls.filter((c) => c.args?.patch?.ramGB !== undefined).length === 1, "memory is stored exactly once");

    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
} finally {
    dispose();
}
