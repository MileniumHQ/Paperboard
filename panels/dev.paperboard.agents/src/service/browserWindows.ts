// The browser's windows: the tabs it has open, the session each is used
// through, and the input they take. One input event goes through `dispatch`,
// which knows that a page paused on a JavaScript dialog answers nothing until
// the dialog is answered. Starting and stopping the browser is browser.ts.

import { errorMessage } from "@mileniumhq/paperapi";
import type { PageDialog } from "../contract";
import type { Cdp } from "./cdp";
import { chord } from "./keys";
import type { Mark } from "./pageScripts";

const LOAD_MS = 15_000;
const MAX_TABS = 16;
const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

/** A refusal the agent reads as the tool's answer. */
export class ToolError extends Error {}

export interface Tab {
    id: number;
    targetId: string;
    sessionId: string | null;
    attaching: Promise<string> | null;
    title: string;
    url: string;
    /** the latest look's marks; clicks by mark use these */
    marks: Mark[] | null;
    size: { width: number; height: number };
    /** a JavaScript dialog waiting for an answer: the page is paused until it gets one */
    dialog: PageDialog | null;
    /** a file picker the page opened, waiting for `upload` */
    chooser: { backendNodeId: number; multiple: boolean } | null;
    world: { frameId: string; contextId: number } | null;
    loads: Set<() => void>;
    /** told when a dialog opens: input that opened one isn't answered until the dialog is */
    dialogWaiters: Set<() => void>;
    pointer: { x: number; y: number; buttons: number; lastDown: { at: number; x: number; y: number; button: number; count: number } | null };
}

export interface WindowsDeps {
    /** the browser's DevTools connection; throws while it isn't running */
    connection(): Cdp;
    /** something the agent is told with its next tool's answer */
    note(text: string): void;
    platform: NodeJS.Platform;
}

export class Windows {
    readonly tabs = new Map<string, Tab>();
    private byId = new Map<number, string>();
    private nextId = 1;

    constructor(private deps: WindowsDeps) {}

    /** The browser went away: every window with it, and the next one is window 1 again. */
    clear() {
        for (const t of this.tabs.values()) for (const w of t.loads) w();
        this.tabs.clear();
        this.byId.clear();
        this.nextId = 1;
    }

    /** No windows are open: the next one is window 1. */
    restartNumbering() {
        if (!this.tabs.size) this.nextId = 1;
    }

    listen(cdp: Cdp) {
        const bySession = (sessionId?: string) => [...this.tabs.values()].find((t) => t.sessionId === sessionId);
        cdp.on("Target.targetCreated", (p) => this.track(p.targetInfo));
        cdp.on("Target.targetInfoChanged", (p) => {
            const t = this.tabs.get(p.targetInfo?.targetId);
            if (t) Object.assign(t, { title: String(p.targetInfo.title ?? ""), url: String(p.targetInfo.url ?? "") });
        });
        cdp.on("Target.targetDestroyed", (p) => this.untrack(p.targetId));
        cdp.on("Target.detachedFromTarget", (p) => {
            const t = bySession(p.sessionId);
            if (t) Object.assign(t, { sessionId: null, world: null });
        });
        cdp.on("Page.javascriptDialogOpening", (p, s) => {
            const t = bySession(s);
            if (!t) return;
            const type = (["alert", "confirm", "prompt", "beforeunload"] as const).find((x) => x === p.type) ?? "alert";
            t.dialog = { type, message: String(p.message ?? "").slice(0, 500) };
            for (const w of t.dialogWaiters) w();
            t.dialogWaiters.clear();
        });
        cdp.on("Page.javascriptDialogClosed", (_p, s) => {
            const t = bySession(s);
            if (t) t.dialog = null;
        });
        cdp.on("Page.fileChooserOpened", (p, s) => {
            const t = bySession(s);
            if (t && Number.isInteger(p.backendNodeId)) t.chooser = { backendNodeId: p.backendNodeId, multiple: p.mode === "selectMultiple" };
        });
        const loaded = (s?: string) => {
            const t = bySession(s);
            if (!t) return;
            for (const w of t.loads) w();
            t.loads.clear();
        };
        cdp.on("Page.loadEventFired", (_p, s) => loaded(s));
        // a page back from the back/forward cache, or a move within the page, has no load of its own
        cdp.on("Page.frameNavigated", (p, s) => {
            if (p.type === "BackForwardCacheRestore" && !p.frame?.parentId) loaded(s);
        });
        cdp.on("Page.navigatedWithinDocument", (_p, s) => loaded(s));
        cdp.on("Runtime.executionContextsCleared", (_p, s) => {
            const t = bySession(s);
            if (t) t.world = null;
        });
    }

    track(info: any) {
        if (info?.type !== "page" || this.tabs.has(info.targetId)) return;
        if (this.tabs.size >= MAX_TABS) {
            void (async () => this.deps.connection().send("Target.closeTarget", { targetId: info.targetId }))().then(
                () => this.deps.note(`A new window was closed: ${MAX_TABS} are open already. Close some first.`),
                (e) => this.deps.note(`A new window is past the limit of ${MAX_TABS} and couldn't be closed: ${errorMessage(e)}`),
            );
            return;
        }
        const tab: Tab = {
            id: this.nextId++,
            targetId: info.targetId,
            sessionId: null,
            attaching: null,
            title: String(info.title ?? ""),
            url: String(info.url ?? ""),
            marks: null,
            size: { width: 1272, height: 730 },
            dialog: null,
            chooser: null,
            world: null,
            loads: new Set(),
            dialogWaiters: new Set(),
            pointer: { x: 0, y: 0, buttons: 0, lastDown: null },
        };
        this.tabs.set(info.targetId, tab);
        this.byId.set(tab.id, info.targetId);
        // attached at once, so a dialog or a file picker it opens before anyone looks is still seen; a failure
        // here is tried again, and reported, by the window's next use
        void this.session(tab).catch((e) => console.warn(`[agents] couldn't attach to window ${tab.id} yet:`, errorMessage(e)));
    }

    untrack(targetId: string) {
        const t = this.tabs.get(targetId);
        if (!t) return;
        for (const w of t.loads) w();
        this.tabs.delete(targetId);
        this.byId.delete(t.id);
    }

    session(tab: Tab): Promise<string> {
        if (tab.sessionId) return Promise.resolve(tab.sessionId);
        tab.attaching ??= (async () => {
            const cdp = this.deps.connection();
            const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
            await Promise.all([
                cdp.send("Page.enable", {}, sessionId),
                cdp.send("Page.setInterceptFileChooserDialog", { enabled: true }, sessionId),
                // every tab acts focused, so typing reaches the one being used, not only the front one
                cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId),
            ]);
            tab.sessionId = sessionId;
            await this.measure(tab);
            return sessionId;
        })().finally(() => (tab.attaching = null));
        return tab.attaching;
    }

    /** the title and address as they are now, not as the last event left them */
    async refreshInfo(tab: Tab) {
        const { targetInfo } = await this.deps.connection().send<any>("Target.getTargetInfo", { targetId: tab.targetId });
        Object.assign(tab, { title: String(targetInfo?.title ?? ""), url: String(targetInfo?.url ?? "") });
    }

    /** every window's title and address as the browser has them: a change event can be missed, a listing can't be */
    async refreshAll() {
        const { targetInfos } = await this.deps.connection().send<any>("Target.getTargets", {});
        for (const info of Array.isArray(targetInfos) ? targetInfos : []) {
            const t = this.tabs.get(info?.targetId);
            if (t) Object.assign(t, { title: String(info.title ?? ""), url: String(info.url ?? "") });
        }
    }

    async measure(tab: Tab) {
        const m = await this.deps.connection().send<any>("Page.getLayoutMetrics", {}, tab.sessionId!);
        const v = m.cssLayoutViewport ?? m.layoutViewport;
        if (v?.clientWidth && v?.clientHeight) tab.size = { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
    }

    tab(window: unknown): Tab {
        const id = Number(window);
        const targetId = Number.isInteger(id) ? this.byId.get(id) : undefined;
        const tab = targetId ? this.tabs.get(targetId) : undefined;
        if (!tab) throw new ToolError(`There's no window ${String(window)}; \`windows\` lists them.`);
        return tab;
    }

    /** Run a script in the tab's own isolated world: the page's scripts can't see it or change what it reads. */
    async evaluate(tab: Tab, expression: string, timeoutMs = 10_000): Promise<any> {
        const s = await this.session(tab);
        const cdp = this.deps.connection();
        for (let attempt = 0; ; attempt++) {
            if (!tab.world) {
                const { frameTree } = await cdp.send<any>("Page.getFrameTree", {}, s);
                const frameId = frameTree.frame.id as string;
                const { executionContextId } = await cdp.send<any>("Page.createIsolatedWorld", { frameId, worldName: "paperboard-agent", grantUniveralAccess: false }, s);
                tab.world = { frameId, contextId: executionContextId };
            }
            try {
                const r = await cdp.send<any>(
                    "Runtime.evaluate",
                    { expression, contextId: tab.world.contextId, returnByValue: true, awaitPromise: true },
                    s,
                    timeoutMs,
                );
                if (r.exceptionDetails) throw new ToolError(`the page's script failed: ${String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200)}`);
                return r.result?.value;
            } catch (e) {
                // the page navigated: its world went with it
                if (attempt === 0 && !(e instanceof ToolError) && /context/i.test(errorMessage(e))) {
                    tab.world = null;
                    continue;
                }
                throw e;
            }
        }
    }

    async mouse(tab: Tab, type: string, at: { x: number; y: number }, extra: Record<string, unknown> = {}) {
        const s = await this.session(tab);
        await this.dispatch(tab, "Input.dispatchMouseEvent", { type, x: at.x, y: at.y, buttons: tab.pointer.buttons, ...extra }, s);
        tab.pointer.x = at.x;
        tab.pointer.y = at.y;
    }

    /**
     * One input event. The browser answers it once the page has handled it, so one that opens a dialog is
     * answered only when the dialog is: the dialog opening is its answer here, and the dialog is reported.
     */
    private async dispatch(tab: Tab, method: string, params: Record<string, unknown>, s: string) {
        // the page is paused on a dialog: nothing reaches it until it's answered, and the caller reports the dialog
        if (tab.dialog) return;
        let opened = () => {};
        const dialog = new Promise<"dialog">((ok) => {
            opened = () => ok("dialog");
            tab.dialogWaiters.add(opened);
        });
        const sent = this.deps.connection().send(method, params, s);
        try {
            await Promise.race([sent, dialog]);
        } finally {
            tab.dialogWaiters.delete(opened);
        }
        // still waiting on the dialog: its answer comes with the dialog's, or its failure is the browser's
        sent.catch((e) => {
            if (this.tabs.has(tab.targetId)) this.deps.note(`Window ${tab.id} didn't take an input after its dialog: ${errorMessage(e)}`);
        });
    }

    async press(tab: Tab, at: { x: number; y: number }, button: keyof typeof BUTTON_BITS, clickCount: number) {
        tab.pointer.buttons |= BUTTON_BITS[button];
        await this.mouse(tab, "mousePressed", at, { button, clickCount });
    }

    async lift(tab: Tab, at: { x: number; y: number }, button: keyof typeof BUTTON_BITS, clickCount: number) {
        tab.pointer.buttons &= ~BUTTON_BITS[button];
        await this.mouse(tab, "mouseReleased", at, { button, clickCount });
    }

    async keys(tab: Tab, names: string[]) {
        const s = await this.session(tab);
        for (const name of names) {
            if (tab.dialog) {
                await this.answerDialog(tab, name);
                continue;
            }
            const events = chord(name, this.deps.platform);
            if (typeof events === "string") throw new ToolError(events);
            for (const e of events) {
                if (tab.dialog) break; // the key before opened one
                await this.dispatch(tab, "Input.dispatchKeyEvent", e, s);
            }
            await new Promise((r) => setTimeout(r, 30));
        }
    }

    private async answerDialog(tab: Tab, key: string, promptText?: string) {
        const k = key.toLowerCase();
        if (k !== "return" && k !== "enter" && k !== "escape") throw new ToolError(`${dialogNote(tab)}`);
        await this.deps.connection().send("Page.handleJavaScriptDialog", { accept: k !== "escape", ...(promptText === undefined ? {} : { promptText }) }, tab.sessionId!);
        tab.dialog = null;
    }

    async text(tab: Tab, text: string) {
        const s = await this.session(tab);
        if (tab.dialog) {
            if (tab.dialog.type !== "prompt") throw new ToolError(dialogNote(tab));
            await this.answerDialog(tab, "Return", text);
            return;
        }
        if (text) await this.deps.connection().send("Input.insertText", { text }, s);
    }

    /** Wait for the tab's next load, up to a limit; true when it loaded. */
    loaded(tab: Tab, ms = LOAD_MS): { done: Promise<boolean>; cancel: () => void } {
        let cancel = () => {};
        const done = new Promise<boolean>((ok) => {
            const t = setTimeout(() => {
                tab.loads.delete(w);
                ok(false);
            }, ms);
            const w = () => {
                clearTimeout(t);
                ok(true);
            };
            tab.loads.add(w);
            cancel = () => {
                clearTimeout(t);
                tab.loads.delete(w);
                ok(false);
            };
        });
        return { done, cancel };
    }

    async navigate(tab: Tab, url: string) {
        const s = await this.session(tab);
        const load = this.loaded(tab);
        const r = await this.deps.connection().send<any>("Page.navigate", { url }, s, LOAD_MS);
        if (r.errorText) {
            load.cancel();
            throw new ToolError(navigationError(url, r.errorText));
        }
        // a same-document navigation has no load to wait for
        if (!r.loaderId) load.cancel();
        const ok = await load.done;
        return ok ? "" : " It's still loading.";
    }

    /** Close a window; one the browser couldn't close stays listed, as it's still open. */
    async closeWindow(tab: Tab) {
        await this.deps.connection().send("Target.closeTarget", { targetId: tab.targetId });
        this.untrack(tab.targetId);
    }

    /** A window of its own at an address, once its page has loaded (or is still loading: `still` says so). */
    async openWindow(url: string): Promise<{ tab: Tab; still: string }> {
        if (this.tabs.size >= MAX_TABS) throw new ToolError(`${MAX_TABS} windows are open already; close some first.`);
        // a window of its own, not a tab: a headless browser draws only its front tab, so a background tab never
        // answers a screenshot (the user's view of it hung), and resizing one tab's window resized them all
        const { targetId } = await this.deps.connection().send<{ targetId: string }>("Target.createTarget", { url: "about:blank", newWindow: true });
        const tab = this.tabs.get(targetId) ?? (this.track({ type: "page", targetId, title: "", url: "about:blank" }), this.tabs.get(targetId));
        if (!tab) throw new ToolError("the browser didn't open a window");
        let still = "";
        try {
            if (url !== "about:blank") still = await this.navigate(tab, url);
        } catch (e) {
            // a window that never got its page isn't left behind
            await this.closeAfter(tab, e);
            throw e;
        }
        await this.refreshInfo(tab);
        return { tab, still };
    }

    /** Do something in a window opened for it at an address, and close it again after, whichever way it went. */
    async inWindow<T>(url: string, job: (session: string) => Promise<T>): Promise<T> {
        const { tab } = await this.openWindow(url);
        let done: T;
        try {
            done = await job(await this.session(tab));
        } catch (e) {
            await this.closeAfter(tab, e);
            throw e;
        }
        await this.closeWindow(tab);
        return done;
    }

    /** Close a window whose job failed: a window that won't close is added to that failure, which stays the one reported. */
    private async closeAfter(tab: Tab, failure: unknown) {
        try {
            await this.closeWindow(tab);
        } catch (closing) {
            throw new ToolError(`${errorMessage(failure)} Its window ${tab.id} couldn't be closed: ${errorMessage(closing)}`);
        }
    }
}

export function dialogNote(tab: Tab): string {
    const d = tab.dialog!;
    const what = d.type === "beforeunload" ? "The page asks whether to leave it" : `The page shows a ${d.type} dialog${d.message ? `: "${d.message}"` : ""}`;
    return `${what}. Press Return to accept${d.type === "prompt" ? " (or type an answer)" : ""} or Escape to dismiss it.`;
}

function navigationError(url: string, error: string): string {
    if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_HTTP_RESPONSE_CODE_FAILURE/.test(error)) {
        return `Couldn't open ${url}: the site can't be reached, or it's on this computer or its local network, which your browser can't reach (${error}).`;
    }
    if (/ERR_NAME_NOT_RESOLVED/.test(error)) return `Couldn't open ${url}: there's no such site (${error}).`;
    return `Couldn't open ${url} (${error}).`;
}
