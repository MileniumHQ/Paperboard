// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome (packages/testkit/src/chrome.ts). Its calls reach the panel
// service in this test process through the test daemon.
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { openChrome, type Page } from "testkit/chrome";
import { servePanelUi } from "testkit/panelUi";
import { PANEL_ID } from "../../src/servers";
import { onDaemonStop, type TestDaemon } from "./crane";

export type { Page } from "testkit/chrome";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.gameserver.test.daemonPorts");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

/** serves the built UI with a panel credential the test daemon issued; widgetUrl() and panelHostUrl() (packages/testkit/src/panelUi.ts) address a Home widget and a framed page under it */
export async function servePanel(daemon: TestDaemon): Promise<{ url: string; stop: () => void }> {
    const granted = await getTransport().call("auth:panel-token", { panelId: PANEL_ID });
    return servePanelUi({ panelDir: PANEL, panelId: PANEL_ID, port: daemon.port, token: granted.token });
}

/** opens `url` in a fresh headless Chrome with a throwaway profile; `windowSize` is "width,height" */
export async function openPage(url: string, windowSize = "1400,900"): Promise<Page> {
    const page = await openChrome(url, {
        windowSize,
        // the hermetic guard lets the test reach this Chrome's DevTools
        onPort: (port) => allowedPorts.add(port),
        isCall: (frame) => frame.includes('"action":"blocks:call"'),
    });
    onDaemonStop(() => page.close());
    return page;
}
