// The whole server page (App) for a Palworld server on real PaperUI. Like the
// real service, reading the options pushes fresh gameSettings to the page, and
// the state can arrive before the page knows the server's game.
// Opened as gamePage.html?server=s1 by test/gamePage.test.ts.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";
import { initialServerState } from "../../src/service/initialState";
import { serverStateKey } from "../../src/servers";

const checks: Record<string, unknown> = {};
const uncaught: string[] = [];
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
// the bridges report refused hydration on console.debug, out of sight
const refused: string[] = [];
const debug = console.debug.bind(console);
console.debug = (...args: unknown[]) => { refused.push(args.map(String).join(" ")); debug(...args); };

const key = serverStateKey("s1");
const state: Record<string, unknown> = {
    servers: [{ id: "s1", name: "Fixture", game: "palworld", directory: "servers/s1", createdAt: 1, configured: true, icon: null, state: { serverStatus: "offline", serverSoftware: "palworld", serverVersion: "1.0.5", serverPort: "8211", recoveryBlock: null, maxPlayers: 32, playerCount: 0 } }],
    serversError: null,
    [key]: { ...initialServerState(), serverSoftware: "palworld", serverVersion: "1.0.5", serverPort: "8211", gameSettings: { ServerName: "Pals" } },
};
const listeners = new Map<string, Set<(payload: unknown) => void>>();
actionsApi.on = ((_panel: string, event: string, cb: (payload: unknown) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return () => listeners.get(event)!.delete(cb);
}) as typeof actionsApi.on;
let reads = 0;
actionsApi.call = (async (_panel: string, action: string) => {
    if (action === "__getState") return state;
    if (action === "s1/read-game-options") {
        reads++;
        // the service reloads the options into state on every read: a new object each time
        const settings = { ServerName: "Pals", ExpRate: 1 };
        state[key] = { ...(state[key] as object), gameSettings: settings };
        for (const cb of listeners.get("__stateChanged") ?? []) cb({ state: { [key]: state[key] } });
        return settings;
    }
    return {};
}) as typeof actionsApi.call;

const wait = async (what: string, predicate: () => boolean) => {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}: ${document.body.innerText.slice(0, 400)}`);
};
const text = () => document.body.innerText;

let error = "";
try {
    const { default: App } = await import("../../src/App");
    render(() => <PaperProvider><App /></PaperProvider>, document.getElementById("app")!);
    await wait("the server menu", () => text().includes("Options"));
    const menu = [...document.querySelectorAll<HTMLElement>("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "Options");
    if (!menu) throw new Error("No Options menu entry");
    let mutations = 0;
    menu.click();
    await wait("the options", () => text().includes("Server name"));
    new MutationObserver((records) => (mutations += records.length)).observe(document.body, { subtree: true, childList: true });
    const readsShown = reads;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    checks.optionsShown = text().includes("Server name");
    checks.readsWhileShown = reads - readsShown;
    checks.mutationsWhileIdle = mutations;
    checks.refused = refused.filter((line) => line.includes("Error"));
} catch (err) {
    error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
}
checks.uncaught = uncaught;
document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify({ checks, error }))))}`;
