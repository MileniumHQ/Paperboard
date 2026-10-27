// Build with properties.vite.ts and open /test/fixtures/properties.html. The real Options and
// Advanced tabs against a server.properties that can't be read: they must say so and offer a
// retry, never show (and later save) a form of defaults over the real settings.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi, fileApi } from "@mileniumhq/paperapi";

let readable = false;
const writes: string[] = [];
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async () => ({})) as typeof actionsApi.call;
fileApi.read = async (path: string) => {
    if (path === "server.properties" && !readable) throw new Error("Disk unplugged");
    return path === "server.properties" ? "difficulty=hard\nmax-players=7\n" : null;
};
fileApi.write = (async (path: string) => {
    writes.push(path);
}) as typeof fileApi.write;

const { default: Options } = await import("../../src/components/Options");
const { default: Advanced } = await import("../../src/components/Advanced");
const root = document.getElementById("app")!;
let dispose = () => {};
const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${document.body.innerText}`);
};
const text = () => root.textContent ?? "";
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); };
try {
    for (const [name, Tab, field] of [["Options", Options, "Max Players"], ["Advanced", Advanced, "Memory Allocation"]] as const) {
        readable = false;
        dispose = render(() => <PaperProvider><Tab /></PaperProvider>, root);
        await wait(() => text().includes("Disk unplugged"));
        assert(text().includes("Couldn't read server.properties"), `${name} must name the file it couldn't read`);
        assert(!text().includes("Loading settings"), `${name} must not keep loading after a failed read`);
        if (name === "Options") assert(!text().includes(field), "Options must not show a form of defaults");
        readable = true;
        button("Try again")!.click();
        await wait(() => text().includes(field) && !text().includes("Disk unplugged"));
        assert(writes.length === 0, `${name} must not write while loading`);
        dispose();
    }
    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
} finally {
    dispose();
}
