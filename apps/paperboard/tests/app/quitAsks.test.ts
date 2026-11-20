import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { installDevPanelInto } from "../../scripts/devPanel";
import { BUILD_TIMEOUT_MS, buildApp, buildCrane, type BuiltApp } from "../platform/app/support/build";
import { startCrane, WAIT_MS, type RunningCrane } from "../platform/app/support/crane";
import { domCondition, launchElectron, SHELL, shellReady, type ElectronApp } from "../platform/app/support/electron";
import { tempDataDir, tempDir } from "../platform/app/support/temp";

// an editor whose note is unsaved until Save, and asks before it goes
const NOTES = {
    source: path.join(import.meta.dir, "../shell/support/notes-panel"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};
const FRAME = "panel://local.dev.paperboard.testnotes/";

let app: BuiltApp;
let daemon: RunningCrane;
let electron: ElectronApp;

beforeAll(async () => {
    const [built, crane] = await Promise.all([buildApp(), buildCrane()]);
    app = built;
    const dataDir = tempDataDir("quit-asks");
    await installDevPanelInto(NOTES, dataDir);
    daemon = await startCrane(crane.file, dataDir);
    // an update check runs offline: the registry is a closed port, and the
    // AppImage updater of an unpacked build looks at no feed
    const appImage = path.join(tempDir("quit-asks-appimage"), "Paperboard.AppImage");
    fs.writeFileSync(appImage, "never run");
    electron = await launchElectron({
        appDir: app.dir,
        dataDir,
        args: ["--skip-update", "--allow-registry-override"],
        env: { ORIGAMI_REGISTRY_URL: "http://127.0.0.1:1", APPIMAGE: appImage },
    });
    await shellReady(electron);
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
    await electron?.quit();
    await daemon?.stop();
});

const alive = () => electron.child.exitCode === null && electron.child.signalCode === null;

// Inventory: Data loss — quitting with an unsaved note asks the note first: Stay keeps Paperboard open, Discard quits.
test("quitting with an unsaved note asks the note: Stay keeps Paperboard running, Discard quits", async () => {
    await electron.evalIn(SHELL, `document.querySelector('[role=radio][aria-label^="This Computer"]').click()`);
    const item = `document.querySelector('[class*=panelList] label[data-value="dev.paperboard.testnotes"]')`;
    await electron.evalIn(SHELL, domCondition(item));
    await electron.evalIn(SHELL, `${item}.click()`);
    await electron.evalInFrame(FRAME, domCondition(`document.getElementById("note")`));
    // the note's "unsaved" message reaches the shell before this marker
    // does, and the shell tells main before its next IPC answers
    await electron.evalIn(SHELL, `window.flushed = new Promise((resolve) => addEventListener("message", (e) => e.data === "test-flush" && resolve())); true`);
    await electron.evalInFrame(FRAME, `(() => { const note = document.getElementById("note"); note.value = "groceries"; note.dispatchEvent(new Event("input")); parent.postMessage("test-flush", "*"); })()`);
    await electron.evalIn(SHELL, `window.flushed.then(() => window.paperboardShell.invoke("app-version"))`);

    const asked = `!document.getElementById("ask").hidden`;
    await electron.evalMain(`app.quit(); return true;`);
    await electron.evalInFrame(FRAME, domCondition(asked));
    expect(alive()).toBe(true);
    await electron.evalInFrame(FRAME, `document.getElementById("stay").click()`);
    await electron.evalInFrame(FRAME, domCondition(`document.getElementById("ask").hidden`));
    // still running, the note as it was
    expect(await electron.evalInFrame(FRAME, `document.getElementById("note").value`)).toBe("groceries");
    expect(alive()).toBe(true);

    await electron.evalMain(`app.quit(); return true;`);
    await electron.evalInFrame(FRAME, domCondition(asked));
    await electron.evalInFrame(FRAME, `document.getElementById("discard").click()`);
    expect(await electron.exited).toEqual({ code: 0, signal: null });
    expect(electron.failures()).toEqual([]);
}, WAIT_MS * 4);
