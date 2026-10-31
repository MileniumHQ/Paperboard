// Build with failures.vite.ts and open /test/fixtures/failures.html. The real panel against a
// terminal service that fails on cue: a tab that didn't open, a rename the service refused and
// a keystroke into a session that's gone must each be said, never dropped. It also checks the
// tab strip's layout: the tab, the New Tab button and the Saved commands button must not touch.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi, terminalApi } from "@mileniumhq/paperapi";

const failing = new Set<string>();
const state = { tabs: [{ id: "t1", label: "Shell" }], activeTabId: "t1", savedCommands: [], commandRuns: {}, savedCommandsError: "" };
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string) => {
    if (failing.has(action)) throw new Error(`${action} is down`);
    if (action === "__getState") return structuredClone(state);
    if (action === "open-tab") return "";
    return true;
}) as typeof actionsApi.call;
terminalApi.onData = () => () => {};
terminalApi.resize = async () => {};
terminalApi.write = async () => {
    if (failing.has("write")) throw new Error('Terminal "t1" not found');
};

const { default: App } = await import("../../src/App");
const { activeTerminals } = await import("../../src/Terminal");

const wait = async (predicate: () => boolean, label: string) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${label} (page: ${(document.body.textContent ?? "").slice(0, 300)})`);
};
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label);
const screen = () => {
    const term = activeTerminals.get("t1")!;
    const lines: string[] = [];
    for (let i = 0; i < term.buffer.active.length; i++) lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
};

try {
    render(() => <PaperProvider fullWidth fullHeight><App /></PaperProvider>, document.getElementById("app")!);
    await wait(() => activeTerminals.has("t1"), "the saved tab must open");

    const tabItem = [...document.querySelectorAll<HTMLElement>("*")].reverse().find((el) => el.textContent === "Shell")!.closest<HTMLElement>("[class*=PaperListItem]")!;
    const gaps = [
        button("New Tab")!.getBoundingClientRect().left - tabItem.getBoundingClientRect().right,
        button("Saved commands")!.getBoundingClientRect().left - button("New Tab")!.getBoundingClientRect().right,
    ];
    if (gaps.some((gap) => gap < 1)) throw new Error(`the tab, New Tab and Saved commands must be spaced apart (gaps: ${gaps.join(", ")}px)`);

    failing.add("create-tab");
    button("New Tab")!.click();
    await wait(() => text().includes("Tab not opened") && text().includes("create-tab is down"), "a tab that didn't open must be shown");
    button("Dismiss")!.click();
    await wait(() => !text().includes("Tab not opened"), "a shown failure must dismiss");

    failing.add("rename-tab");
    // the innermost element naming the tab; the event bubbles to the tab's own handler
    const tab = [...document.querySelectorAll<HTMLElement>("*")].reverse().find((el) => el.textContent === "Shell")!;
    tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await wait(() => text().includes("Rename Tab"), "the tab menu must open");
    [...document.querySelectorAll<HTMLElement>("*")].reverse().find((el) => el.textContent?.trim() === "Rename Tab")!.click();
    await wait(() => document.activeElement?.matches("[role=dialog] input") ?? false, "the rename field must take focus");
    const field = document.activeElement as HTMLInputElement;
    field.value = "Build";
    field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    button("Save")!.click();
    await wait(() => text().includes("Tab not renamed") && text().includes("rename-tab is down"), "a refused rename must be shown");
    if (!document.querySelector("[role=dialog]")) throw new Error("a refused rename must keep the modal open");
    button("Cancel")!.click();
    await wait(() => !document.querySelector("[role=dialog]"), "Cancel must close the rename");

    failing.add("write");
    activeTerminals.get("t1")!.input("l");
    await wait(() => screen().includes('Lost this terminal: Terminal "t1" not found'), "a keystroke into a gone session must be said");

    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL ${err instanceof Error ? err.message : String(err)}`;
}
