// Build with setup.vite.ts and open /test/fixtures/setup.html. Real UI and bridge, controlled
// upstream catalog/download/persistence failures; no daemon or user data access.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi, fileApi, packageApi } from "@mileniumhq/paperapi";
import { ACTION_IDS } from "../../src/service/contract";

let failure = "java";
let complete = false;
let downloads = 0;
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panelId: string, action: string) => {
    if (action === ACTION_IDS.updatePanelConfig && failure === "save") throw new Error("Config save failed");
    return {};
}) as typeof actionsApi.call;
packageApi.isInstalled = async () => {
    if (failure === "java") throw new Error("Java unavailable");
    return true;
};
fileApi.download = (async () => {
    downloads++;
    if (failure === "download") throw new Error("Download failed");
}) as typeof fileApi.download;
fileApi.read = async () => {
    if (failure === "eula-read") throw new Error("EULA read failed");
    return null;
};
fileApi.write = async () => {
    if (failure === "eula-write") throw new Error("EULA write failed");
};
globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("version_manifest_v2.json")) return Response.json({ versions: [
        { id: "rd-132211", type: "old_alpha" },
        { id: "b1.8.1", type: "old_beta" },
        { id: "1.21.11", type: "release" },
    ] });
    if (url.endsWith("/builds/1")) return Response.json({ downloads: { "server:default": { url: "https://fixture.invalid/server.jar", checksums: { sha256: "fixture" } } } });
    if (url.endsWith("/versions/1.21.11")) return Response.json({ builds: [1] });
    if (url.endsWith("/projects/paper")) return Response.json({ versions: { "1.21": ["rd-132211", "1.21.11"] } });
    throw new Error(`Unexpected fixture request: ${url}`);
}) as typeof fetch;

const { default: Setup } = await import("../../src/components/Setup");
const { default: VersionPicker } = await import("../../src/components/VersionPicker");
const root = document.getElementById("app")!;
let dispose = () => {};
const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${document.body.innerText}`);
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!;
const click = (text: string) => {
    const target = button(text);
    if (!target || target.disabled) throw new Error(`Missing enabled button: ${text}`);
    target.click();
};
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); };
try {
    let selected = "";
    dispose = render(() => <PaperProvider><VersionPicker software="vanilla" selectedVersion="" onSelectVersion={(v) => { selected = v; }} /></PaperProvider>, root);
    await wait(() => selected !== "");
    assert(selected === "1.21.11", "must select a supported release");
    assert(!root.textContent?.includes("rd-132211") && !root.textContent?.includes("b1.8.1"), "must hide historical versions");
    const snapshot = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((el) => el.closest("label")?.textContent?.includes("Snapshots"));
    assert(snapshot?.disabled, "Snapshots must be disabled when unavailable");
    dispose();
    dispose = render(() => <PaperProvider><Setup onComplete={() => { complete = true; }} /></PaperProvider>, root);
    click("Next");
    click("Next");
    await wait(() => !button("Next")?.disabled);
    click("Next");
    await wait(() => root.textContent?.includes("Java unavailable") ?? false);
    assert(button("Finish Setup").disabled, "failure must block completion");
    failure = "download";
    click("Retry setup");
    await wait(() => root.textContent?.includes("Download failed") ?? false);
    click("Change software or version");
    await wait(() => root.textContent?.includes("Server Software") ?? false);
    click("Next");
    await wait(() => !button("Next")?.disabled);
    failure = "eula-read";
    click("Next");
    await wait(() => root.textContent?.includes("EULA read failed") ?? false);
    failure = "eula-write";
    click("Retry setup");
    await wait(() => !!button("Agree & Continue"));
    click("Agree & Continue");
    await wait(() => document.body.textContent?.includes("EULA write failed") ?? false);
    assert(!complete, "EULA failure must not complete setup");
    failure = "save";
    click("Agree & Continue");
    await wait(() => !button("Finish Setup")?.disabled);
    click("Finish Setup");
    await wait(() => root.textContent?.includes("Config save failed") ?? false);
    assert(!complete, "save failure must not complete setup");
    failure = "";
    click("Finish Setup");
    await wait(() => complete);
    // Java failed before any server download; three later attempts reached it.
    assert(downloads === 3, "each subsequent installation attempt should download once");
    document.getElementById("result")!.textContent = "PASS: historical versions hidden; unavailable channel disabled; Java, download, EULA read/write and config failures recover without reinstalling.";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${String(err)}`;
} finally {
    dispose();
}
