// Panel permissions in App Settings, which the shell shows only in an
// Electron window (a browser asks for itself), run as one (ELECTRON_PRELOAD)
// against the host's real permission store.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, clickText, toastShown, type Shell } from "./support/shell";


const PANEL = "dev.example.notes";
const SWITCH = `[role=switch][aria-label='Let ${PANEL} use the microphone']`;
const checked = () => shell.page.evaluate<string>(`document.querySelector(${JSON.stringify(SWITCH)}).getAttribute("aria-checked")`);

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ init: ELECTRON_PRELOAD });
    await shell.host({ cmd: "set-permission", panelId: PANEL, permission: "microphone", answer: "allowed" });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a switch flips at once, saves in order, and falls back with an error.
test("a panel permission switch flips at once and plays its press, saves, and puts itself back when the save fails", async () => {
    const { page } = shell;
    await shell.host({ cmd: "hold-permission-saves" });
    await page.click("[role=radio][aria-label='Settings']");
    await page.waitFor(`document.querySelector(${JSON.stringify(SWITCH)})?.getAttribute("aria-checked") === "true"`, "the microphone switch, on");
    // whether the knob ever plays its press, however briefly
    await page.evaluate(`(() => {
        const knob = document.querySelector(${JSON.stringify(SWITCH)});
        window.__pressed = false;
        new MutationObserver(() => { if (knob.className.includes("_animating_")) window.__pressed = true; }).observe(knob, { attributes: true });
    })()`);

    // off, while its save is still out: the switch shows it at once and stays usable
    await page.click(SWITCH);
    expect(await checked()).toBe("false");
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(SWITCH)}).getAttribute("aria-disabled")`)).toBe(null);
    expect(await page.evaluate(`window.__pressed`)).toBe(true);
    expect(await shell.host<string>({ cmd: "held-permission-save" })).toBe("denied");
    await shell.host({ cmd: "release-permission-save" });
    expect(await shell.host({ cmd: "permission", panelId: PANEL, permission: "microphone" })).toBe("denied");

    // on again, and that save is refused: the switch goes back and says why
    await page.click(SWITCH);
    expect(await checked()).toBe("true");
    expect(await shell.host<string>({ cmd: "held-permission-save" })).toBe("allowed");
    await shell.host({ cmd: "release-permission-save", fail: "The permissions file is read-only" });
    await page.waitFor(
        `document.querySelector(${JSON.stringify(SWITCH)}).getAttribute("aria-checked") === "false" && ${toastShown("Couldn't change the permission", "The permissions file is read-only")}`,
        "the switch back off, and a toast saying why",
    );
    expect(await shell.host({ cmd: "permission", panelId: PANEL, permission: "microphone" })).toBe("denied");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a permission Paperboard couldn't decide is refused with why on screen, not a bare NotAllowedError.
test("a panel's request that failed to be decided is said in a toast, with why", async () => {
    const { page } = shell;
    await shell.host({
        cmd: "push",
        channel: "panel-permission-failed",
        payload: { computerId: "local", panelId: PANEL, permissions: ["microphone", "camera"], message: "Panel permissions in panel-permissions.json aren't valid JSON" },
    });
    await page.waitFor(toastShown(`${PANEL} can't use your microphone and camera`, "Paperboard couldn't decide, so it said no", "aren't valid JSON"), "the failure, in a toast");
    // nothing to answer: it isn't a dialog
    expect(await page.evaluate(`[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("can't use your"))`)).toBe(false);
    await page.evaluate(`[...document.querySelectorAll("[aria-label=Notifications] [role=alert]")].find((t) => t.innerText.includes("aren't valid JSON")).querySelector("button[aria-label=Close]").dataset.closeThis = ""`);
    await page.click("[data-close-this]");
    await page.waitFor(`!${toastShown("aren't valid JSON")}`, "the toast closed");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a view that couldn't load says "Couldn't load" with Try again, and a toast says why.
test("panel permissions that can't be listed say Couldn't load, with why in a toast, and Try again lists them", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='Home']");
    await shell.host({ cmd: "fail-permission-list", message: "The permissions file is locked" });
    await page.click("[role=radio][aria-label='Settings']");
    await page.waitFor(toastShown("Couldn't load panel permissions", "The permissions file is locked"), "a toast saying why");
    await page.waitFor(`document.body.innerText.includes("Couldn't load") && !document.querySelector(${JSON.stringify(SWITCH)})`, "Couldn't load, in place of the list");
    await clickText(page, "button", "Try again");
    await page.waitFor(`!!document.querySelector(${JSON.stringify(SWITCH)}) && !${toastShown("Couldn't load panel permissions")}`, "the list, and the toast gone");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — an answer that doesn't go through keeps its question open, and a toast says why.
// Last: the host can't answer for an Electron window, so the question stays.
test("an answer to a panel's request that fails keeps the dialog open, with why in a toast", async () => {
    const { page } = shell;
    // the browser suite's host has no Electron window to answer for: the answer fails for real
    await shell.host({
        cmd: "push",
        channel: "panel-permission-ask",
        payload: { askId: "ask-1", computerId: "local", panelId: PANEL, permissions: ["camera"] },
    });
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("use your camera?"))`;
    await page.waitFor(`!!${dialog}`, "the question");
    await clickText(page, "button", "Allow");
    await page.waitFor(toastShown("Your answer didn't go through", "panel-permission-answer"), "a toast saying why");
    expect(await page.evaluate(`!!${dialog}`)).toBe(true);
    expect(page.exceptions).toEqual([]);
});
