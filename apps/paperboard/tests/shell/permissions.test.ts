// Panel permissions in App Settings, which the shell shows only in an
// Electron window (a browser asks for itself), run as one (ELECTRON_PRELOAD)
// against the host's real permission store.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, type Shell } from "./support/shell";


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
        `document.querySelector(${JSON.stringify(SWITCH)}).getAttribute("aria-checked") === "false" && document.body.innerText.includes("The permissions file is read-only")`,
        "the switch back off, with why",
    );
    expect(await shell.host({ cmd: "permission", panelId: PANEL, permission: "microphone" })).toBe("denied");
    expect(page.exceptions).toEqual([]);
});
