// Updates as the shell shows them, in an Electron window (browser mode runs
// none): the host pushes the update queue's states the way main's queue
// does while it runs. An open panel shows that it is updating and loads
// again once its new release is in place, unless the update was held back;
// a Stop and update that fails says why, and so does Paperboard's own update
// that failed, in its dialog.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { UpdateHold, UpdateItem, UpdateQueueState } from "../../src/shared/updateQueue";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, clickText, errorShown, WIDGET_DEMO, type Shell } from "./support/shell";

const PANEL = "dev.paperboard.widgetdemo";
const KEY = `local::${PANEL}`;
const frame = `document.querySelector("iframe[data-panel-key='${KEY}']")`;
const loaded = `${frame}?.contentDocument?.readyState === "complete" && ${frame}.contentDocument.location.href !== "about:blank"`;
const updating = `!!${frame}.parentElement.querySelector("[aria-label^='Updating panel']")`;
const rowDisabled = `document.querySelector("label[data-value='${PANEL}'] input").disabled`;


let shell: Shell;
let revision = 0;

function update(key: string, status: UpdateItem["status"]): UpdateItem {
    return {
        key,
        kind: "panel",
        computerId: "local",
        computerName: null,
        panelId: PANEL,
        name: "Widget Demo",
        version: "2.0.0",
        status,
        stage: status === "running" ? "installing" : null,
        percent: null,
        bytesLoaded: null,
        bytesTotal: null,
        error: null,
    };
}

const HOLD: UpdateHold = {
    key: "hold-widgets",
    kind: "panel",
    computerId: "local",
    computerName: null,
    id: PANEL,
    name: "Widget Demo",
    version: "2.0.0",
    sha256: null,
    users: ["Widget Demo"],
};

function push(items: UpdateItem[], holds: UpdateHold[] = [], holdsError: string | null = null): Promise<unknown> {
    const state: UpdateQueueState = { revision: ++revision, checking: false, items, holds, checkError: null, holdsError };
    return shell.host({ cmd: "push-update-queue", state });
}

beforeAll(async () => {
    shell = await bootShell({ init: ELECTRON_PRELOAD, panels: [WIDGET_DEMO] });
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("label[data-value='${PANEL}']")`, "Widget Demo in the sidebar");
    await page.click(`label[data-value='${PANEL}']`);
    await page.waitFor(loaded, "Widget Demo's page to load");
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Updates — an open panel never runs on files its update is replacing, and comes back on the new ones.
test("an open panel shows its update while it installs, and loads again once it is in place", async () => {
    const { page } = shell;
    await page.evaluate(`${frame}.contentWindow.kept = true`);

    await push([update("widgets-1", "running")]);
    await page.waitFor(`${updating} && ${rowDisabled}`, "the panel's page to say it is updating, and its row to be disabled");
    // the panel's name stands a full gap over the bar, not pressed onto it
    const room = await page.evaluate<{ gap: number; uigap: number }>(`(() => {
        const bar = ${frame}.parentElement.querySelector("[aria-label^='Updating panel']");
        const name = bar.closest("[class*='_overlay_']").querySelector("h1");
        const probe = document.createElement("div");
        probe.style.height = "var(--paper-uigap)";
        document.querySelector(".paperui-root").append(probe);
        const uigap = probe.getBoundingClientRect().height;
        probe.remove();
        return { gap: bar.getBoundingClientRect().top - name.getBoundingClientRect().bottom, uigap };
    })()`);
    expect(room.gap).toBeGreaterThanOrEqual(room.uigap - 0.5);

    await push([update("widgets-1", "done")]);
    await page.waitFor(`!${updating} && ${loaded} && !${frame}.contentWindow.kept`, "the panel's page to load again");
    expect(await page.evaluate(rowDisabled)).toBe(false);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — an update held back replaced nothing, so the page is left as it was.
test("an update held back by what is using it leaves the open page as it was", async () => {
    const { page } = shell;
    await page.evaluate(`${frame}.contentWindow.kept = true`);
    const src = await page.evaluate<string>(`${frame}.src`);

    await push([update("widgets-2", "running")]);
    await page.waitFor(updating, "the panel's page to say it is updating");

    await push([update("widgets-2", "held")], [HOLD]);
    // the hold opens the update list on its own, and the page is back as it was
    await page.waitFor(`!${updating} && [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Stop and update"))`, "the held update in the update list");
    expect(await page.evaluate(`${frame}.src`)).toBe(src);
    expect(await page.evaluate(`${frame}.contentWindow.kept`)).toBe(true);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — Stop and update that can't run says why, and can be pressed again.
test("Stop and update that fails says why, and runs when pressed again", async () => {
    const { page } = shell;
    await shell.host({ cmd: "fail-release", message: "The panel's files are in use by another program" });
    // the list the hold opened is still easing in; a press lands once it has
    await page.motionSettled();
    await clickText(page, "button", "Stop and update");
    await page.waitFor(
        `document.body.innerText.includes("Widget Demo couldn't update") && document.body.innerText.includes("The panel's files are in use by another program")`,
        "the failure, said",
    );

    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Stop and update") && !b.disabled)`, "Stop and update, ready again");
    await page.motionSettled();
    await clickText(page, "button", "Stop and update");
    expect(await shell.host<string[]>({ cmd: "next-release" })).toEqual([HOLD.key]);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — a computer that can't say which updates wait on it is named, not dropped from the list in silence.
test("updates waiting on a computer that couldn't be read are said", async () => {
    const { page } = shell;
    const why = "Basement PC didn't say which updates wait on it: Paperboard Server RPC 'package:pending' timed out.";
    await push([], [HOLD], why);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(why)})`, "the unread computer, said");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — Update everything now says every outcome: looking, up to date, installed, failed with why, and the linked panels it can't update.
test("Update everything now says what it is doing and what it came to", async () => {
    const { page } = shell;
    const says = (text: string) => `document.body.innerText.includes(${JSON.stringify(text)})`;
    await page.click("[role=radio][aria-label='Settings']");
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Update everything now"))`, "App Settings");

    await clickText(page, "button", "Update everything now");
    await page.waitFor(says("Looking for updates to Paperboard"), "the look, said while it runs");
    await shell.host({ cmd: "answer-update-check", outcome: { updated: 0, held: 0, failed: 0, linked: 2, problem: null } });
    await page.waitFor(says("Everything is up to date. 2 linked panels weren't updated: they run from their source folder."), "up to date, and the linked panels, said");

    await clickText(page, "button", "Update everything now");
    await shell.host({ cmd: "answer-update-check", outcome: { updated: 3, held: 0, failed: 0, linked: 0, problem: null } });
    await page.waitFor(says("Installed 3 updates."), "the updates installed, said");

    await clickText(page, "button", "Update everything now");
    await shell.host({ cmd: "answer-update-check", outcome: { updated: 0, held: 0, failed: 1, linked: 0, problem: "Widget Demo didn't update: the download was refused" } });
    await page.waitFor(`${says("Not everything updated")} && ${says("Widget Demo didn't update: the download was refused.")}`, "the failure and its reason, said");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — an update that failed says why in its dialog, beside the retry.
test("an update that failed says why in its dialog, never only in a toast", async () => {
    const { page } = shell;
    await shell.host({
        cmd: "push",
        channel: "app-update-state",
        payload: { revision: 1000, status: "failed", installMode: "automatic", version: "1.4.0", percent: null, error: "The download was cut off: the update server closed the connection" },
    });
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Paperboard update failed"))`;
    const title = "Paperboard couldn't update";
    await page.waitFor(`${errorShown(title, "The download was cut off")} && !!${dialog}?.querySelector("[data-paper-error]")`, "the failure, in the update dialog");
    await clickText(page, "button", "Later");
    await page.waitFor(`!${dialog}`, "the dialog closed");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — Paperboard's own download is the top bar's to show; its dialog is for what needs a choice.
test("a download in progress has no dialog, and a new attempt closes a failure's", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='Home']");
    const railAction = `document.querySelector("button[aria-label^='Paperboard update']")`;
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Paperboard update"))`;
    const appUpdate = (revision: number, status: string) =>
        shell.host({
            cmd: "push",
            channel: "app-update-state",
            payload: { revision, status, installMode: "automatic", version: "1.5.0", percent: status === "downloading" ? 40 : null, error: status === "failed" ? "The update server closed the connection" : null },
        });

    await appUpdate(2000, "downloading");
    await page.waitFor(`!${dialog} && !${railAction}`, "no dialog and no rail button while it downloads");
    await appUpdate(2001, "failed");
    await page.waitFor(`!!${dialog} && !!${railAction}`, "the failure's dialog, and the rail's way back to it");
    await appUpdate(2002, "downloading");
    await page.waitFor(`!${dialog} && !${railAction}`, "the failure's dialog closed once a new attempt downloads");
    await appUpdate(2003, "ready");
    await page.waitFor(`!!${railAction}`, "the rail's update button back once the download is ready");
    await page.click("button[aria-label^='Paperboard update']");
    await page.waitFor(`!!${dialog} && ${dialog}.innerText.includes("Version 1.5.0 is downloaded")`, "the ready dialog");
    await clickText(page, "button", "Later");
    await page.waitFor(`!${dialog}`, "the dialog closed");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Updates — an MSI install says its administrator updates it, and offers no download of its own.
test("an MSI install is told its administrator installs the update, with nothing to download", async () => {
    const { page } = shell;
    await shell.host({
        cmd: "push",
        channel: "app-update-state",
        payload: { revision: 3000, status: "manual", installMode: "administrator", version: "1.6.0", percent: null, error: null },
    });
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Paperboard update available"))`;
    await page.waitFor(`!!${dialog} && ${dialog}.innerText.includes("Paperboard 1.6.0 is available. Your administrator installs updates to this copy of Paperboard.")`, "the administrator notice");
    expect(await page.evaluate(`${dialog}.innerText.includes("Download")`)).toBe(false);
    await clickText(page, "button", "Later");
    await page.waitFor(`!${dialog}`, "the dialog closed");
    expect(page.exceptions).toEqual([]);
});
