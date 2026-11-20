// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome (packages/testkit/src/chrome.ts). Its calls reach the panel
// service through the test daemon.
import { afterAll } from "bun:test";
import * as path from "node:path";
import { launchChrome, type Chrome, type Page as ChromePage } from "testkit/chrome";
import { servePanelUi } from "testkit/panelUi";
import { PANEL_ID } from "../../src/bots";
import { testDaemon } from "./daemon";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.botcreator.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

/** serves the built UI with a panel credential the test daemon issued; widgetUrl() (packages/testkit/src/panelUi.ts) addresses a Home widget under it */
export async function servePanel(): Promise<{ url: string; stop: () => void }> {
    const daemon = await testDaemon();
    return servePanelUi({ panelDir: PANEL, panelId: PANEL_ID, port: daemon.port, token: await daemon.panelToken(PANEL_ID) });
}

export type Page = ChromePage;

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
            return (await chrome).open(url);
        },
    };
}

/** the text of every toast showing, failures and the rest, oldest first */
export const TOASTS = `[...document.querySelectorAll("[aria-label=Notifications] [role=alert], [aria-label=Notifications] [role=status]")].map((t) => t.innerText)`;
