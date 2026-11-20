// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued) and mobile mode
// (data-paper-mobile, off), and opened in headless Chrome
// (packages/testkit/src/chrome.ts). Its calls reach the panel service through the
// test daemon.
import { afterAll } from "bun:test";
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { launchChrome, type Chrome, type Page as ChromePage } from "testkit/chrome";
import { servePanelUi } from "testkit/panelUi";
import { testDaemon } from "./crane";
import { PANEL_ID } from "./service";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.terminal.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

/** serves the built UI, in desktop mode, with a panel credential the test daemon issued; widgetUrl() (packages/testkit/src/panelUi.ts) addresses a Home widget under it */
export async function servePanel(): Promise<{ url: string; stop: () => void }> {
    const daemon = await testDaemon();
    const granted = await getTransport().call("auth:panel-token", { panelId: PANEL_ID });
    return servePanelUi({ panelDir: PANEL, panelId: PANEL_ID, port: daemon.port, token: granted.token, mobile: false });
}

export interface Page extends ChromePage {
    /** types `text` into whatever has focus, as a keyboard would */
    insertText(text: string): Promise<void>;
    /** clicks, as a mouse would, the innermost shown `selector` element whose text includes `text` */
    clickText(selector: string, text: string): Promise<void>;
    /** presses and lets go of one key (Enter, Tab, Escape…) in whatever has focus, as a keyboard would */
    press(key: "Enter" | "Escape" | "Tab"): Promise<void>;
}

const KEYS = { Enter: [13, "\r"], Escape: [27, ""], Tab: [9, "\t"] } as const;

/**
 * One headless Chrome for the test file that calls this (at its top level),
 * started with its first page and stopped once the file is done; each page
 * opens in a browser context of its own.
 */
export function panelBrowser(): { open(url: string): Promise<Page> } {
    let chrome: Promise<Chrome> | null = null;
    afterAll(async () => {
        if (chrome) await (await chrome).close();
    });
    return {
        async open(url) {
            chrome ??= launchChrome({
                windowSize: "1200,800",
                // the hermetic guard lets the test reach this Chrome's DevTools
                onPort: (port) => allowedPorts.add(port),
            });
            const page = (await (await chrome).open(url)) as Page;
            page.insertText = async (text) => {
                await page.send("Input.insertText", { text });
            };
            page.press = async (key) => {
                const [keyCode, text] = KEYS[key];
                await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
                await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode });
            };
            page.clickText = async (selector, text) => {
                const tag = `t${Math.random().toString(36).slice(2)}`;
                const shown = `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getClientRects().length > 0 && el.innerText?.includes(${JSON.stringify(text)}))`;
                await page.waitFor(`${shown}.length > 0`, `a ${selector} showing "${text}"`);
                // a menu that just opened places itself on the next frame: it is clicked where it settles
                await page.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
                await page.evaluate(`(() => {
                    const all = ${shown};
                    const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
                    inner[0].dataset.test = ${JSON.stringify(tag)};
                })()`);
                await page.click(`[data-test="${tag}"]`);
            };
            return page;
        },
    };
}

/** resolves once every call the page has sent so far has its answer */
export async function answered(page: Page): Promise<void> {
    const ids = page.sentFrames.map((f) => JSON.parse(f).id).filter((id) => id !== undefined);
    for (const id of ids) await page.received((f) => JSON.parse(f).id === id, `the answer to call ${id}`);
}

/** a page expression: a failure toast shows `title` and `text` */
export const toastShows = (title: string, text: string) =>
    `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].some((t) => t.innerText.includes(${JSON.stringify(title)}) && t.innerText.includes(${JSON.stringify(text)}))`;
