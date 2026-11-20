// App Settings in the real shell: changes made one after another, faster
// than a save comes back, are all kept, and so are changes made before the
// saved settings finished loading.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { waitFor } from "testkit/wait";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;

// Holds the daemon's answer to the shell's first read of its app settings
// until the test releases it: the read a slow daemon answers last.
const HOLD_SETTINGS_LOAD = `(() => {
    const held = new Set();
    const queue = [];
    let arrived;
    window.__settingsLoadArrived = new Promise((resolve) => (arrived = resolve));
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        const message = JSON.parse(data);
        if (message.action === "config:get" && message.params?.id === "app-settings" && !window.__settingsLoadReleased) held.add(message.id);
        return send.call(this, data);
    };
    const listen = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function (type, listener, options) {
        if (type !== "message") return listen.call(this, type, listener, options);
        return listen.call(this, type, (event) => {
            if (!held.has(JSON.parse(event.data).id)) return listener.call(this, event);
            queue.push(() => listener.call(this, event));
            arrived();
        }, options);
    };
    window.__releaseSettingsLoad = () => new Promise((resolve) => {
        window.__settingsLoadReleased = true;
        for (const deliver of queue.splice(0)) deliver();
        // a task later, every step the shell takes on the answer has run
        setTimeout(resolve);
    });
})()`;

beforeAll(async () => {
    shell = await bootShell({ init: HOLD_SETTINGS_LOAD });
});

afterAll(async () => {
    await shell?.close();
});

/** resolves once the saved app settings satisfy `ready`; read again and again, since a folder's watcher (fs.watch) misses writes under Bun */
function savedSettings(ready: (saved: Record<string, unknown>) => boolean, what: string): Promise<Record<string, unknown>> {
    // app-wide settings live with the daemon's own state, not with the panels' configs
    const file = path.join(shell.dataDir, "local", "app-settings.json");
    return waitFor(what, () => {
        if (!fs.existsSync(file)) return null;
        const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        return ready(saved) ? saved : null;
    }, { timeoutMs: 20_000 });
}

const SWITCHES = `[document.querySelector("input[name=disableAnimations]").checked, document.querySelector("input[name=disableBlur]").checked]`;

// Inventory: Core contracts — a change is never undone by a save or a load that was already under way.
test("two switches flipped at once, before the saved settings loaded, both end on, on screen and on disk", async () => {
    const { page } = shell;
    await page.evaluate(`window.__settingsLoadArrived`);
    await page.click("[role=radio][aria-label='Settings']");
    await page.waitFor(`document.querySelector("input[name=disableAnimations]") && document.querySelector("input[name=disableBlur]")`, "App Settings");
    expect(await page.evaluate(SWITCHES)).toEqual([false, false]);

    // the second flip comes before the first save can answer
    await page.evaluate(`document.querySelector("input[name=disableAnimations]").click(); document.querySelector("input[name=disableBlur]").click();`);
    const saved = await savedSettings((s) => s.disableAnimations === true && s.disableBlur === true, "both switches to be saved on");
    expect(saved).toMatchObject({ disableAnimations: true, disableBlur: true });

    // the load, asked before either change, answers last
    await page.evaluate(`window.__releaseSettingsLoad()`);
    expect(await page.evaluate(SWITCHES)).toEqual([true, true]);
    expect(page.exceptions).toEqual([]);
});
