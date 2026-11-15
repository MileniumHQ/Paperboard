// The user's own view of the agent's computer: its windows' pictures, the
// user's input once they've taken control, and the values of a sign-in the
// agent asked for, typed in where it said.

import { createHash } from "node:crypto";
import { LIMITS, type ComputerWindow, type WindowFrame } from "../contract";
import type { BrowserComputer } from "./browser";
import { ToolError, type Tab } from "./browserWindows";
import { close, go, SCROLL_PX, siteOf } from "./browserTools";
import { EDITABLE_JS, SIGN_IN_FOCUS_JS, SIGN_IN_MOVED_JS } from "./pageScripts";

// the user's view polls frames from every open shell; it gets its own few slots so it never starves the agent
const MAX_VIEW_CALLS = 3;
const VIEW_MAX_EVENTS = 64;
const VIEW_MAX_TEXT = 2000;
const BUTTON_NAMES = { 1: "left", 2: "middle", 3: "right" } as const;

/** One of the view's calls, in the view's few slots; `using` the windows needs the user to have taken control. */
async function viewing<T>(c: BrowserComputer, using: boolean, run: () => Promise<T>): Promise<T> {
    if (using && !c.state.userControl) throw new Error("Take control of the computer first.");
    if (!c.on) throw new Error("The computer isn't on.");
    if (c.viewCalls >= MAX_VIEW_CALLS) throw new Error("The computer is busy showing other views; try again.");
    c.viewCalls++;
    try {
        return await run();
    } catch (e) {
        throw e instanceof ToolError ? new Error(e.message) : e;
    } finally {
        c.viewCalls--;
    }
}

/** The user looking at (and, with control, using) the browser's windows. */
export const browserView = {
    windows: (c: BrowserComputer): Promise<ComputerWindow[]> =>
        viewing(c, false, async () => {
            await c.windows.refreshAll();
            return [...c.windows.tabs.values()]
                .sort((a, b) => a.id - b.id)
                .map((t) => ({ id: t.id, title: t.title || t.url, url: t.url, app: "Helium", width: t.size.width, height: t.size.height }));
        }),
    frame: (c: BrowserComputer, args: Record<string, unknown>) => viewing(c, false, () => frame(c, args)),
    input: (c: BrowserComputer, args: Record<string, unknown>) => viewing(c, true, () => input(c, args)),
    go: (c: BrowserComputer, args: Record<string, unknown>) => viewing(c, true, () => go(c, args)),
    close: (c: BrowserComputer, args: Record<string, unknown>) => viewing(c, false, () => close(c, args)),
    signIn: (c: BrowserComputer, args: Record<string, unknown>) => viewing(c, false, () => signInFill(c, args)),
};

async function frame(c: BrowserComputer, args: Record<string, unknown>): Promise<WindowFrame> {
    const tab = c.windows.tab(args.window);
    // a page waiting on a dialog can't be pictured: the last picture stands, with the dialog to answer
    if (tab.dialog) return { same: true, hash: typeof args.since === "string" ? args.since : "", dialog: tab.dialog };
    const s = await c.windows.session(tab);
    const quality = Math.max(30, Math.min(90, Number.isInteger(args.quality) ? (args.quality as number) : 72));
    const { data } = await c.connection().send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality }, s, 10_000);
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 24);
    if (args.since === hash) return { same: true, hash, dialog: null };
    await c.windows.measure(tab);
    return { frame: data, hash, width: tab.size.width, height: tab.size.height, dialog: null };
}

async function input(c: BrowserComputer, args: Record<string, unknown>) {
    const tab = c.windows.tab(args.window);
    const events = args.events;
    if (!Array.isArray(events) || events.length > VIEW_MAX_EVENTS) throw new ToolError(`send at most ${VIEW_MAX_EVENTS} events at a time`);
    const inside = (e: Record<string, unknown>) => {
        const x = Number(e.x);
        const y = Number(e.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= tab.size.width || y >= tab.size.height) throw new ToolError("that point is outside the window");
        return { x: Math.floor(x), y: Math.floor(y) };
    };
    for (const raw of events) {
        const e = (raw ?? {}) as Record<string, unknown>;
        switch (e.type) {
            case "move":
                if (!tab.dialog) await c.windows.mouse(tab, "mouseMoved", inside(e));
                break;
            case "down":
            case "up": {
                const button = BUTTON_NAMES[Number(e.button) as 1 | 2 | 3];
                if (!button) throw new ToolError("unknown mouse button");
                if (tab.dialog) break;
                const at = e.x !== undefined ? inside(e) : { x: tab.pointer.x, y: tab.pointer.y };
                if (e.type === "down") {
                    const last = tab.pointer.lastDown;
                    const again = last && last.button === Number(e.button) && Date.now() - last.at < 500 && Math.abs(last.x - at.x) <= 4 && Math.abs(last.y - at.y) <= 4;
                    const count = again ? Math.min(3, last.count + 1) : 1;
                    tab.pointer.lastDown = { at: Date.now(), x: at.x, y: at.y, button: Number(e.button), count };
                    await c.windows.press(tab, at, button, count);
                } else await c.windows.lift(tab, at, button, tab.pointer.lastDown?.count ?? 1);
                break;
            }
            case "scroll": {
                if (tab.dialog) break;
                const dy = Math.max(-20, Math.min(20, Math.trunc(Number(e.dy ?? 0)) || 0));
                const dx = Math.max(-20, Math.min(20, Math.trunc(Number(e.dx ?? 0)) || 0));
                if (dy || dx) await c.windows.mouse(tab, "mouseWheel", inside(e), { deltaX: dx * SCROLL_PX, deltaY: dy * SCROLL_PX });
                break;
            }
            case "key":
                await c.windows.keys(tab, [String(e.keys ?? "")]);
                break;
            case "text": {
                const text = String(e.text ?? "");
                if (text.length > VIEW_MAX_TEXT) throw new ToolError(`type at most ${VIEW_MAX_TEXT} characters at a time`);
                await c.windows.text(tab, text);
                break;
            }
            default:
                throw new ToolError(`unknown input ${JSON.stringify(e.type)}`);
        }
    }
}

/** The user's values, typed into the fields the waiting request named, then submit pressed. Used once. */
async function signInFill(c: BrowserComputer, args: Record<string, unknown>) {
    const p = c.signIn;
    if (!p || p.id !== args.id) throw new ToolError("that sign-in isn't waiting anymore");
    const values = args.values;
    if (!Array.isArray(values) || values.length !== p.fields.length || !values.every((v) => typeof v === "string" && v.length <= LIMITS.signIn.valueChars)) {
        throw new ToolError(`one value per field, each at most ${LIMITS.signIn.valueChars} characters`);
    }
    c.signIn = null; // used once, whatever happens next
    const tab = c.windows.tabs.get(p.targetId);
    if (!tab) throw new ToolError("that page isn't open anymore");
    const onSite = async () => {
        const [origin] = await c.windows.evaluate(tab, EDITABLE_JS);
        if (siteOf(origin) !== p.site) throw new ToolError(`the page isn't on ${p.site} anymore`);
    };
    if (siteOf(tab.url) !== p.site) throw new ToolError(`the page isn't on ${p.site} anymore`);
    const s = await c.windows.session(tab);
    for (const [i, at] of p.fields.entries()) {
        const value = values[i] as string;
        await c.windows.mouse(tab, "mouseMoved", at);
        await c.windows.press(tab, at, "left", 1);
        await c.windows.lift(tab, at, "left", 1);
        await new Promise((r) => setTimeout(r, 150));
        const [origin, editable, maxLength] = await c.windows.evaluate(tab, EDITABLE_JS);
        if (siteOf(origin) !== p.site) throw new ToolError(`the page isn't on ${p.site} anymore`);
        if (!editable) throw new ToolError(`field ${i + 1} didn't take the cursor; the page may have changed`);
        if (maxLength > 0 && maxLength < value.length) await typeSplit(c, tab, s, value);
        else await c.connection().send("Input.insertText", { text: value }, s);
    }
    await onSite();
    if (p.submit) {
        await c.windows.mouse(tab, "mouseMoved", p.submit);
        await c.windows.press(tab, p.submit, "left", 1);
        await c.windows.lift(tab, p.submit, "left", 1);
    } else await c.windows.keys(tab, ["Return"]); // the last field still has the cursor
}

/** A code longer than its box: a key at a time, moving to the next box whenever the site leaves the cursor in a full one. */
async function typeSplit(c: BrowserComputer, tab: Tab, s: string, value: string) {
    const chars = [...value];
    for (const [i, ch] of chars.entries()) {
        await c.windows.evaluate(tab, SIGN_IN_FOCUS_JS);
        const code = /^[0-9]$/.test(ch) ? `Digit${ch}` : /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : "";
        const vk = /^[a-z0-9]$/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : 0;
        await c.connection().send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, windowsVirtualKeyCode: vk, text: ch, unmodifiedText: ch }, s);
        await c.connection().send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk }, s);
        await new Promise((r) => setTimeout(r, 30)); // the site's own handler moves the cursor
        if (i < chars.length - 1 && (await c.windows.evaluate(tab, SIGN_IN_MOVED_JS))) await c.windows.keys(tab, ["Tab"]);
    }
}
