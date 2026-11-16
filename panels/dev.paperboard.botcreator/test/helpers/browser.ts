// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome (scripts/testing/chrome.ts). Its calls reach the panel
// service through the test daemon.
import { afterAll } from "bun:test";
import * as path from "node:path";
import { launchChrome, type Chrome, type Page as ChromePage } from "../../../../scripts/testing/chrome";
import { servePanelUi } from "../../../../scripts/testing/panelUi";
import { PANEL_ID } from "../../src/bots";
import { testDaemon } from "./daemon";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.botcreator.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

/** serves the built UI with a panel credential the test daemon issued; widgetUrl() (scripts/testing/panelUi.ts) addresses a Home widget under it */
export async function servePanel(): Promise<{ url: string; stop: () => void }> {
    const daemon = await testDaemon();
    return servePanelUi({ panelDir: PANEL, panelId: PANEL_ID, port: daemon.port, token: await daemon.panelToken(PANEL_ID) });
}

export interface Page extends ChromePage {
    /** drags the element `selector` finds `dx` px to the right with the mouse, in steps, and lets go */
    drag(selector: string, dx: number): Promise<void>;
}

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
            page.drag = async (selector, dx) => {
                const box = await page.evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
                if (!box) throw new Error(`Nothing to drag matches ${selector}`);
                const mouse = (type: string, x: number, buttons: number, extra: Record<string, unknown> = {}) =>
                    page.send("Input.dispatchMouseEvent", { type, x, y: box.y, button: "left", buttons, ...extra });
                await mouse("mouseMoved", box.x, 0);
                await mouse("mousePressed", box.x, 1, { clickCount: 1 });
                const steps = 10;
                for (let step = 1; step <= steps; step++) await mouse("mouseMoved", box.x + (dx * step) / steps, 1);
                await mouse("mouseReleased", box.x + dx, 0, { clickCount: 1 });
            };
            return page;
        },
    };
}

/** the text of every toast showing, failures and the rest, oldest first */
export const TOASTS = `[...document.querySelectorAll("[aria-label=Notifications] [role=alert], [aria-label=Notifications] [role=status]")].map((t) => t.innerText)`;

/** a wait expression: a failure toast titled `title` shows, saying `text` when given */
export const toastShows = (title: string, text = "") =>
    `[...document.querySelectorAll("[aria-label=Notifications] [role=alert]")].some((t) => t.innerText.includes(${JSON.stringify(title)}) && t.innerText.includes(${JSON.stringify(text)}))`;

/** a wait expression: a PaperError titled `title` stands on the page, saying `text` when given, and no toast says it */
export const errorShows = (title: string, text = "") =>
    `[...document.querySelectorAll("[data-paper-error]")].some((e) => e.getAttribute("aria-label") === ${JSON.stringify(title)} && e.innerText.includes(${JSON.stringify(text)})) && !${toastShows(title)}`;

/** the PaperError titled `title`, as an expression (null while none stands) */
export const paperError = (title: string) => `document.querySelector(${JSON.stringify(`[data-paper-error][aria-label="${title.replace(/"/g, '\\"')}"]`)})`;

/** whether the PaperError titled `title` fills its view (a column, centred) rather than sitting in line */
export const errorFills = (title: string) => `getComputedStyle(${paperError(title)}).flexDirection === "column"`;

/** a selector for the button of the PaperError titled `title` (its Details toggle aside) */
export const errorButtonAt = (title: string) => `[data-paper-error][aria-label="${title.replace(/"/g, '\\"')}"] button:not([aria-expanded])`;

/** the button of the PaperError titled `title`, as an expression */
export const errorButton = (title: string) => `document.querySelector(${JSON.stringify(errorButtonAt(title))})`;
