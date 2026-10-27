// The real Actions App on real PaperUI, over the fake service in
// canvasSyncApi.ts, driven through what a person does on the canvas: a
// canvas that won't load, and a save whose flows were not applied. Results are base64
// JSON in #results so the test can read them from Chrome's --dump-dom output.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import App from "../../src/App";
import { ACTIONS_PANEL_ID } from "../../src/panelId";
import { buildCallSchema, buildTriggerSchema, type FunctionDef } from "../../src/lib/functions";
import { fixture } from "./canvasSyncApi";

const out = { checks: {} as Record<string, unknown>, error: "" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const greet: FunctionDef = { id: "f1", name: "Greet", params: [{ name: "msg", type: "string" }] };
const call = (id: string, pos: { x: number; y: number }, zIndex?: number) => ({
    id,
    panelId: ACTIONS_PANEL_ID,
    pos,
    zIndex,
    isTrigger: false,
    action: buildCallSchema(greet),
    values: {},
});

// every layer the canvas saved sits above the 10 a fresh editor starts from
fixture.initial = {
    flows: [
        { id: "body", panelId: ACTIONS_PANEL_ID, pos: { x: 420, y: 60 }, zIndex: 30, isTrigger: true,
            action: buildTriggerSchema(greet), values: {}, children: [] },
        { id: "play", panelId: "builtin.logic", pos: { x: 820, y: 60 }, zIndex: 20, isTrigger: true,
            action: { id: "on-play", name: "On Play" }, values: {}, children: [call("nested", { x: 0, y: 0 })] },
        call("caller", { x: 420, y: 440 }, 40),
    ],
    notes: [{ id: "note", pos: { x: 820, y: 440 }, zIndex: 60, text: "Saved on top" }],
    functions: [greet],
} as any;
fixture.failApply = false;
fixture.failLoad = true;

const root = document.getElementById("app")!;
render(() => <PaperProvider fullWidth fullHeight><App /></PaperProvider>, root);

const alerts = () => [...root.querySelectorAll<HTMLElement>('[role="alert"]')];
const alertTitled = (title: string) =>
    alerts().find((el) => [...el.querySelectorAll("*")].some((c) => c.textContent?.trim() === title));
const hasExactText = (el: Element | undefined, text: string) =>
    Boolean(el && [...el.querySelectorAll("*")].some((c) => c.textContent?.trim() === text));
const topBlocks = () => [...root.querySelectorAll<HTMLElement>(".canvas-world > .action")];

async function run() {
    const c = out.checks;
    await sleep(300);

    // the canvas can't be read: say so, with the reason and a way back
    const loadAlert = alertTitled("Canvas could not be loaded");
    c.loadFailureTitled = Boolean(loadAlert);
    c.loadFailureReason = hasExactText(loadAlert, "document unavailable");
    const retry = [...root.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry loading canvas"));
    c.loadFailureRetry = Boolean(retry && !retry.disabled);
    if (!retry) throw new Error("no way to retry loading the canvas");
    fixture.failLoad = false;
    retry.click();
    await sleep(500);
    c.loadedAfterRetry = topBlocks().length;
    if (topBlocks().length !== 3) throw new Error(`canvas did not load after retry: ${root.innerHTML.slice(0, 300)}`);

    // a save whose flows weren't applied says so, with a way to retry
    fixture.failApply = true;
    const note = root.querySelector<HTMLTextAreaElement>("textarea")!;
    note.value = "Edited";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(400);
    const syncAlert = alertTitled("Canvas out of sync");
    c.syncErrorTitled = Boolean(syncAlert);
    c.syncErrorReason = Boolean(syncAlert?.textContent?.includes("Canvas saved, but flows were not applied: service unavailable"));
    const retrySave = syncAlert && [...syncAlert.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry saving"));
    c.syncErrorRetry = Boolean(retrySave);
    fixture.failApply = false;
    retrySave?.click();
    await sleep(400);
    c.syncErrorCleared = !alertTitled("Canvas out of sync");
}

void run()
    .catch((err) => { out.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err); })
    .finally(() => {
        const bytes = new TextEncoder().encode(JSON.stringify(out));
        document.getElementById("results")!.textContent = "RESULT:" + btoa(String.fromCharCode(...bytes));
    });
