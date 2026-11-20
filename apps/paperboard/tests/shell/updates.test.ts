// Updates as the shell shows them, in an Electron window (browser mode runs
// none): the host pushes the update queue's states the way main's queue
// does while it runs. An open panel shows that it is updating and loads
// again once its new release is in place, unless the update was held back.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { UpdateHold, UpdateItem, UpdateQueueState } from "../../src/shared/updateQueue";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, WIDGET_DEMO, type Shell } from "./support/shell";

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
