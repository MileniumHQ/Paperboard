// What the agent does with its computer: the tools in COMPUTER_TOOLS
// (computerTools.ts), each a few of the browser's own inputs and reads
// (browserWindows.ts) on one of its windows, answered with what changed.

import fs from "node:fs";
import { errorMessage } from "@mileniumhq/paperapi";
import { LIMITS, type ComputerPhase } from "../contract";
import type { BrowserComputer } from "./browser";
import { ToolError, dialogNote, type Tab } from "./browserWindows";
import type { ToolResult } from "./computerMcp";
import { MARKS_JS, REMOVE_OVERLAY_JS, overlayJs, type Mark } from "./pageScripts";

const SETTLE_MS = 400; // after an action, for what it opens or changes to show
export const SCROLL_PX = 60;
const SCROLL_MAX = 50;
const SIZE_MAX = 8192;
const ZOOM_MAX = 6;
const GRID_STEPS = [2, 5, 10, 20, 25, 50, 100, 200];
const KEYS_MAX = 16;
const UPLOAD_MAX = 10;

/** One of the agent's computer tools, refused with why while the computer can't take it. */
export async function browserTool(c: BrowserComputer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!c.on) {
        const why: Partial<Record<ComputerPhase, string>> = {
            none: "You don't have a computer yet; the user can set one up from the Agent panel.",
            unsupported: `This machine can't run your computer: ${c.state.error ?? "unsupported"}`,
            installing: "Your computer is still being set up.",
            starting: "Your computer is still starting up; try again in a moment.",
        };
        return { isError: true, text: why[c.state.phase] ?? "Your computer is off right now." };
    }
    if (c.state.userControl) {
        return { isError: true, text: "The user has taken control of your computer. Wait until they hand it back, or ask them if they need you." };
    }
    const tool = TOOLS[name];
    if (!tool) return { isError: true, text: `unknown tool ${name}` };
    await c.slot();
    try {
        return await tool(c, args ?? {});
    } catch (e) {
        return { isError: true, text: errorMessage(e) };
    } finally {
        c.release();
    }
}

// the tools themselves, in COMPUTER_TOOLS order
const TOOLS: Record<string, (c: BrowserComputer, args: Record<string, unknown>) => Promise<ToolResult>> = {
    windows,
    open,
    go,
    look,
    zoom,
    click,
    hover,
    drag,
    type,
    key,
    scroll,
    place,
    close,
    upload,
    // the service's half of a sign-in; the agent reaches it only through ask_to_sign_in
    sign_in_prepare: signInPrepare,
};

/** What happened since `before`: windows that opened or closed, downloads, a dialog that's waiting. */
function changes(c: BrowserComputer, before: Set<number>, tab?: Tab): string {
    const now = new Set([...c.windows.tabs.values()].map((t) => t.id));
    const out: string[] = [];
    for (const t of c.windows.tabs.values()) if (!before.has(t.id)) out.push(`Window ${t.id} "${t.title || t.url}" opened.`);
    for (const id of before) if (!now.has(id)) out.push(`Window ${id} closed.`);
    out.push(...c.notes.splice(0));
    if (tab?.dialog && c.windows.tabs.has(tab.targetId)) out.push(dialogNote(tab));
    if (tab?.chooser && c.windows.tabs.has(tab.targetId)) out.push("A file picker opened: pick files from your home folder with `upload`.");
    return out.length ? ` ${out.join(" ")}` : "";
}

function ids(c: BrowserComputer) {
    return new Set([...c.windows.tabs.values()].map((t) => t.id));
}

async function settle() {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
}

function point(tab: Tab, args: Record<string, unknown>, keys = { mark: "mark", x: "x", y: "y" }): { x: number; y: number } {
    if (args[keys.mark] !== undefined) {
        const ms = tab.marks;
        if (!ms) throw new ToolError("look at the window first so its marks are fresh");
        const n = Number(args[keys.mark]);
        if (!Number.isInteger(n) || n < 1 || n > ms.length) throw new ToolError(`mark ${String(args[keys.mark])} doesn't exist; the last look had ${ms.length}`);
        const m = ms[n - 1]!;
        return { x: m.x + Math.floor(m.w / 2), y: m.y + Math.floor(m.h / 2) };
    }
    if (args[keys.x] !== undefined && args[keys.y] !== undefined) {
        const x = Number(args[keys.x]);
        const y = Number(args[keys.y]);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= tab.size.width || y >= tab.size.height) {
            throw new ToolError(`that point is outside the window (${tab.size.width}x${tab.size.height})`);
        }
        return { x, y };
    }
    throw new ToolError("give a mark number, or x and y inside the window");
}

async function windows(c: BrowserComputer): Promise<ToolResult> {
    await c.windows.refreshAll();
    const list = [...c.windows.tabs.values()].sort((a, b) => a.id - b.id);
    if (!list.length) return { text: "No windows are open." };
    return {
        text: list
            .map((t) => `${t.id}: ${t.title || "(untitled)"} <${t.url}> size ${t.size.width}x${t.size.height}${t.dialog ? ` (${dialogNote(t)})` : ""}`)
            .join("\n"),
    };
}

async function open(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const url = webAddress(args.what, true);
    const before = ids(c);
    const { tab, still } = await c.windows.openWindow(url);
    return { text: `Opened window ${tab.id} "${tab.title || tab.url}" <${tab.url}>.${still}` + changes(c, new Set([...before, tab.id]), tab) };
}

export async function go(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const to = typeof args.to === "string" ? args.to.trim() : "";
    const before = ids(c);
    const s = await c.windows.session(tab);
    const cdp = c.connection();
    let still = "";
    if (to === "back" || to === "forward") {
        const h = await cdp.send<any>("Page.getNavigationHistory", {}, s);
        const entry = h.entries?.[h.currentIndex + (to === "back" ? -1 : 1)];
        if (!entry) throw new ToolError(`there's no page to go ${to} to`);
        const load = c.windows.loaded(tab);
        await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, s);
        still = (await load.done) ? "" : " It's still loading.";
    } else if (to === "reload") {
        const load = c.windows.loaded(tab);
        await cdp.send("Page.reload", {}, s);
        still = (await load.done) ? "" : " It's still loading.";
    } else {
        still = await c.windows.navigate(tab, webAddress(to, false));
    }
    await c.windows.refreshInfo(tab);
    return { text: `Window ${tab.id} is at <${tab.url}> "${tab.title}".${still}` + changes(c, before, tab) };
}

async function look(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const s = await c.windows.session(tab);
    await c.connection().send("Target.activateTarget", { targetId: tab.targetId });
    if (tab.dialog) return { text: `Window ${tab.id} "${tab.title}": ${dialogNote(tab)} The page is paused until it's answered.` };
    const page = await c.windows.evaluate(tab, MARKS_JS);
    tab.marks = page.marks as Mark[];
    tab.size = { width: page.width, height: page.height };
    const image = await shot(c, tab, overlayJs({ boxes: tab.marks.map((m, i) => ({ ...m, label: String(i + 1) })) }), { format: "png" }, s);
    const listing = tab.marks.map((m, i) => (m.name ? `${i + 1}. ${m.kind} "${m.name}"` : `${i + 1}. ${m.kind}`)).join("\n");
    let head = `Window ${tab.id} "${page.title}" <${page.url}> (${page.width}x${page.height} px; x/y coordinates are pixels from its top-left).`;
    if (page.crossFrames) head += `\n${page.crossFrames} embedded frame${page.crossFrames === 1 ? " is" : "s are"} from other sites, so ${page.crossFrames === 1 ? "its" : "their"} insides aren't marked: zoom in and use x/y there.`;
    if (tab.chooser) head += "\nA file picker is open: pick files from your home folder with `upload`.";
    return { text: head + (tab.marks.length ? "\nMarks:\n" + listing : "\nNo marks."), images: [{ data: image, type: "image/png" }] };
}

/** A screenshot with something drawn over the page for it, taken away again whatever happens. */
async function shot(c: BrowserComputer, tab: Tab, overlay: string, params: Record<string, unknown>, s: string): Promise<string> {
    await c.windows.evaluate(tab, overlay);
    try {
        const { data } = await c.connection().send<{ data: string }>("Page.captureScreenshot", params, s);
        return data;
    } finally {
        // a page that navigated away took the overlay with it; anything else that fails here is the call's failure
        await c.windows.evaluate(tab, REMOVE_OVERLAY_JS);
    }
}

async function zoom(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const s = await c.windows.session(tab);
    if (tab.dialog) throw new ToolError(dialogNote(tab));
    await c.windows.measure(tab);
    const x = Math.max(0, Math.floor(Number(args.x)));
    const y = Math.max(0, Math.floor(Number(args.y)));
    const w = Math.min(Math.floor(Number(args.width)), tab.size.width - x);
    const h = Math.min(Math.floor(Number(args.height)), tab.size.height - y);
    if (!(w >= 8 && h >= 8)) throw new ToolError(`that region is outside the window (${tab.size.width}x${tab.size.height})`);
    const scale = Math.max(1, Math.min(ZOOM_MAX, 1280 / Math.max(w, h)));
    const step = GRID_STEPS.find((g) => g * scale >= 60) ?? GRID_STEPS.at(-1)!;
    // the latest look's marks keep their numbers here, so either way of clicking works
    const boxes = (tab.marks ?? [])
        .map((m, i) => ({ ...m, label: String(i + 1) }))
        .filter((m) => m.x < x + w && m.x + m.w > x && m.y < y + h && m.y + m.h > y);
    const { visualViewport: vv } = await c.connection().send<any>("Page.getLayoutMetrics", {}, s);
    const image = await shot(c, tab, overlayJs({ boxes, color: "blue", grid: { x, y, w, h, step, scale } }), {
        format: "png",
        // the clip is in the page's coordinates: the viewport's scroll offset moves it to what's on screen
        clip: { x: x + (vv?.pageX ?? 0), y: y + (vv?.pageY ?? 0), width: w, height: h, scale },
    }, s);
    return {
        text: `Region ${x},${y} to ${x + w},${y + h} of window ${tab.id}, enlarged ${scale.toFixed(1)}x. Grid lines every ${step} px are labelled in window coordinates: click with those x/y.`,
        images: [{ data: image, type: "image/png" }],
    };
}

async function click(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    if (tab.dialog) throw new ToolError(dialogNote(tab));
    const at = point(tab, args);
    const button = (["left", "middle", "right"] as const).find((b) => b === (args.button ?? "left"));
    if (!button) throw new ToolError("button is left, middle or right");
    const before = ids(c);
    await c.windows.mouse(tab, "mouseMoved", at);
    await c.windows.press(tab, at, button, 1);
    await c.windows.lift(tab, at, button, 1);
    if (args.double === true) {
        await c.windows.press(tab, at, button, 2);
        await c.windows.lift(tab, at, button, 2);
    }
    await settle();
    return { text: `Clicked at ${at.x},${at.y} in window ${tab.id}.` + changes(c, before, tab) };
}

async function hover(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    if (tab.dialog) throw new ToolError(dialogNote(tab));
    const at = point(tab, args);
    await c.windows.mouse(tab, "mouseMoved", at);
    await new Promise((r) => setTimeout(r, 600));
    return { text: `Pointer resting at ${at.x},${at.y}.` };
}

async function drag(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    if (tab.dialog) throw new ToolError(dialogNote(tab));
    const from = point(tab, args);
    if (args.to_mark === undefined && (args.to_x === undefined || args.to_y === undefined)) throw new ToolError("give to_mark, or to_x and to_y");
    const to = point(tab, args, { mark: "to_mark", x: "to_x", y: "to_y" });
    const before = ids(c);
    await c.windows.mouse(tab, "mouseMoved", from);
    await c.windows.press(tab, from, "left", 1);
    try {
        // in steps, so the page sees a drag rather than a jump
        for (let i = 1; i <= 10; i++) {
            await c.windows.mouse(tab, "mouseMoved", { x: from.x + Math.round(((to.x - from.x) * i) / 10), y: from.y + Math.round(((to.y - from.y) * i) / 10) });
            await new Promise((r) => setTimeout(r, 20));
        }
    } finally {
        await c.windows.lift(tab, to, "left", 1);
    }
    await settle();
    return { text: `Dragged from ${from.x},${from.y} to ${to.x},${to.y}.` + changes(c, before, tab) };
}

async function type(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const before = ids(c);
    await c.windows.text(tab, String(args.text ?? ""));
    if (args.enter === true && !tab.dialog) await c.windows.keys(tab, ["Return"]);
    await settle();
    return { text: "Typed." + changes(c, before, tab) };
}

async function key(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const names = String(args.keys ?? "").split(/\s+/).filter(Boolean);
    if (!names.length || names.length > KEYS_MAX) throw new ToolError(`press 1 to ${KEYS_MAX} keys at a time`);
    const before = ids(c);
    await c.windows.keys(tab, names);
    await settle();
    return { text: `Pressed ${names.join(" ")}.` + changes(c, before, tab) };
}

async function scroll(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    if (tab.dialog) throw new ToolError(dialogNote(tab));
    const at = args.mark !== undefined || args.x !== undefined ? point(tab, args) : { x: Math.floor(tab.size.width / 2), y: Math.floor(tab.size.height / 2) };
    const amount = args.amount === undefined ? 5 : Number(args.amount);
    if (!Number.isInteger(amount) || !amount || Math.abs(amount) > SCROLL_MAX) throw new ToolError(`amount is 1 to ${SCROLL_MAX} steps, negative to scroll up`);
    await c.windows.mouse(tab, "mouseWheel", at, { deltaX: 0, deltaY: amount * SCROLL_PX });
    await settle();
    return { text: `Scrolled ${amount > 0 ? "down" : "up"} ${Math.abs(amount)}.` };
}

async function place(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const width = args.width === undefined ? tab.size.width : Number(args.width);
    const height = args.height === undefined ? tab.size.height : Number(args.height);
    if (![width, height].every((n) => Number.isInteger(n) && n >= 200 && n <= SIZE_MAX)) throw new ToolError(`sizes are 200 to ${SIZE_MAX} px`);
    const cdp = c.connection();
    const { windowId, bounds } = await cdp.send<any>("Browser.getWindowForTarget", { targetId: tab.targetId });
    // the window's own frame around the page, the same before and after
    const dx = bounds.width - tab.size.width;
    const dy = bounds.height - tab.size.height;
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: width + dx, height: height + dy } });
    await settle();
    await c.windows.measure(tab);
    tab.marks = null;
    return { text: `Window ${tab.id} is ${tab.size.width}x${tab.size.height} now.` };
}

export async function close(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    await c.windows.closeWindow(tab);
    return { text: "Closed." };
}

async function upload(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const tab = c.windows.tab(args.window);
    const chooser = tab.chooser;
    if (!chooser) throw new ToolError("No file picker is open in that window: click the page's upload button first.");
    const files = Array.isArray(args.files) ? args.files : [args.files];
    if (!files.length || files.length > UPLOAD_MAX) throw new ToolError(`pick 1 to ${UPLOAD_MAX} files`);
    if (files.length > 1 && !chooser.multiple) throw new ToolError("this picker takes one file");
    const paths = files.map((f) => {
        const full = c.home.resolve(f);
        if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) throw new ToolError(`there's no file at ${c.home.shown(full)}`);
        return full;
    });
    const before = ids(c);
    await c.connection().send("DOM.setFileInputFiles", { files: paths, backendNodeId: chooser.backendNodeId }, await c.windows.session(tab));
    tab.chooser = null;
    await settle();
    return { text: `Picked ${paths.map((p) => c.home.shown(p)).join(", ")}.` + changes(c, before, tab) };
}

/** The agent's picks for a sign-in, checked against its latest look: the page's site and a picture of them. */
async function signInPrepare(c: BrowserComputer, args: Record<string, unknown>): Promise<ToolResult> {
    const rid = String(args.id ?? "");
    if (!/^[a-z0-9]{6,32}$/.test(rid)) throw new ToolError("a sign-in id is lowercase letters and digits");
    const tab = c.windows.tab(args.window);
    const ms = tab.marks;
    if (!ms) throw new ToolError("look at the browser window first so its marks are fresh");
    const fields = args.fields;
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > LIMITS.signIn.fields) throw new ToolError(`pick 1 to ${LIMITS.signIn.fields} fields`);
    const mark = (n: unknown) => {
        const i = Number(n);
        if (!Number.isInteger(i) || i < 1 || i > ms.length) throw new ToolError(`mark ${String(n)} doesn't exist; the last look had ${ms.length}`);
        return [i, ms[i - 1]!] as const;
    };
    const picked = fields.map(mark);
    // no button marked: Enter is pressed in the last field (a page whose button is greyed out until typed in)
    const submit = args.submit !== undefined && args.submit !== null ? mark(args.submit) : null;
    const numbers = [...picked.map(([n]) => n), ...(submit ? [submit[0]] : [])];
    if (new Set(numbers).size !== numbers.length) throw new ToolError("each field, and the submit button, is a different mark");
    for (const [n, m] of picked) if (!["entry", "text", "password text"].includes(m.kind)) throw new ToolError(`mark ${n} is a ${m.kind}, not a text field`);
    const site = siteOf(tab.url);
    const boxes = [...picked.map(([, m], i) => ({ ...m, label: String(i + 1) })), ...(submit ? [{ ...submit[1], label: "submit" }] : [])];
    const s = await c.windows.session(tab);
    const image = await shot(c, tab, overlayJs({ boxes }), { format: "png" }, s);
    const centre = (m: Mark) => ({ x: m.x + Math.floor(m.w / 2), y: m.y + Math.floor(m.h / 2) });
    c.signIn = { id: rid, targetId: tab.targetId, window: tab.id, site, fields: picked.map(([, m]) => centre(m)), submit: submit ? centre(submit[1]) : null };
    return { text: JSON.stringify({ site, fields: picked.map(([, m]) => ({ secret: m.kind === "password text" })) }), images: [{ data: image, type: "image/png" }] };
}

/** What the user is told they're signing in to: the host, with the scheme only when it isn't https. */
export function siteOf(url: string): string {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        throw new ToolError("that page isn't a website");
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname) throw new ToolError("that page isn't a website");
    return u.protocol === "https:" ? u.hostname : `http://${u.hostname}`;
}

/** A web address the agent gave, made whole (example.com is https://example.com), or why it isn't one. */
function webAddress(what: unknown, blankAllowed: boolean): string {
    const s = typeof what === "string" ? what.trim() : "";
    if (blankAllowed && (s === "" || s === "browser" || s === "helium" || s === "about:blank")) return "about:blank";
    if (/^https?:\/\//i.test(s)) {
        try {
            return new URL(s).href;
        } catch {
            throw new ToolError(`${s} isn't a web address`);
        }
    }
    if (/^[^\s/:]+\.[^\s/:]+(:\d+)?([/?#]\S*)?$/.test(s)) return new URL(`https://${s}`).href;
    throw new ToolError(`Open a web address (https://…)${blankAllowed ? ", or `browser` for a blank page" : ""}: your computer is a web browser.`);
}
