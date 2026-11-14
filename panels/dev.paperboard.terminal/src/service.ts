import {
    definePanelService,
    config,
    terminalApi,
    processApi,
    files,
    resolveOneShotShell,
    blocksApi,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import * as fs from "node:fs";
import { SCROLLBACK_CHARS, applyScrollbackCap, readWholeLines } from "./lib/scrollback";
import { errorMessage } from "./lib/failure";
import { PANEL_ID } from "./lib/panel";
import { runShellCommand } from "./lib/shellCommand";
import { writeTerminal } from "./lib/terminalWrite";
import { SavedCommands, type CommandRun, type SavedCommand } from "./lib/savedCommands";
import { BlocksAnnouncer, commandPayload, exitPayload, finishedPayload, tabPayload, terminalBlocks } from "./blocks";
import {
    findSession,
    readLayout,
    readSavedTabs,
    tabSessions,
    type LiveSession,
    type SessionErrorKind,
    type SessionErrors,
    type SplitDirection,
    type TabLayout,
    type TerminalSession,
    type TerminalTab,
} from "./lib/tabs";

interface TerminalServiceState {
    // the tab list every window mirrors; which tab a window shows is that
    // window's own choice, so open windows and computers stay in step
    tabs: TerminalTab[];
    activeTabId: string;
    // what each session's shell has said: the program in front of it, its
    // folder, and the last command it ran (keyed by session id, a split's too)
    live: Record<string, LiveSession>;
    // tabs along the top, or down the side; every window follows it
    layout: TabLayout;
    // Show Tab's request that every open window switch to a tab; each request
    // has its own token, so a window follows it once
    showTab: { id: string; request: string };
    // saved commands (run from Home's "Pinned command" widget) and the last
    // observed outcome of each
    savedCommands: SavedCommand[];
    commandRuns: Record<string, CommandRun>;
    savedCommandsError: string;
    // why tabs.json could not be read; while it is set the tabs are not
    // written, so the file stays as it was
    tabsError: string;
    // what went wrong for a session where no one was waiting on it, by session id
    sessionErrors: SessionErrors;
}

type Ctx = ServiceContext<TerminalServiceState>;

const SCROLLBACK_DIR = "terminal-scrollback";
const TABS_FILE = "tabs.json";

let tabs: TerminalTab[] = [];
let activeTabId = "";
let layout: TabLayout = "horizontal";
const live: Record<string, LiveSession> = {};
// counts commands, so a window can tell a new one from one it has seen
let commandSeq = 0;
let showTabRequest = { id: "", request: "" };
let tabsError = "";
// tab changes are saved one at a time, so a failed save undoes only its own
let tabsSaving: Promise<void> = Promise.resolve();

const buffers = new Map<string, string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
// sessions whose saved scrollback could not be read: unreadable is not
// empty, so it is never written over (a new shell starts a new screen)
const unreadScrollback = new Set<string>();
const sessionErrors: SessionErrors = {};
const subscribedSessions = new Set<string>();
// teardown handles for the listeners above: a closed tab must detach, not
// just hide behind the findSession() guard inside the callbacks
const sessionUnsubs = new Map<string, Array<() => void>>();

function scrollbackPath(id: string): string {
    return `${SCROLLBACK_DIR}/${id}.log`;
}

/** Says (or, with "", stops saying) what went wrong for a session; a change that changes nothing tells no one. */
function setSessionError(id: string, kind: SessionErrorKind, message: string) {
    if ((sessionErrors[id]?.[kind] ?? "") === message) return;
    if (message) {
        console.error(`[TerminalService] ${id}: ${message}`);
        (sessionErrors[id] ??= {})[kind] = message;
    } else {
        delete sessionErrors[id]![kind];
        if (Object.keys(sessionErrors[id]!).length === 0) delete sessionErrors[id];
    }
    serviceCtx?.setState({ sessionErrors: structuredClone(sessionErrors) });
}

function forgetSessionErrors(id: string) {
    unreadScrollback.delete(id);
    if (!sessionErrors[id]) return;
    delete sessionErrors[id];
    serviceCtx?.setState({ sessionErrors: structuredClone(sessionErrors) });
}

async function writeScrollback(id: string): Promise<void> {
    try {
        await files.write(scrollbackPath(id), buffers.get(id) || "", PANEL_ID);
        if (buffers.has(id)) setSessionError(id, "scrollback", "");
    } catch (err) {
        if (buffers.has(id)) {
            setSessionError(id, "scrollback", `What this shell prints isn't being saved, so it won't come back after a restart: ${errorMessage(err)}`);
        }
    }
}

function schedulePersist(id: string) {
    if (unreadScrollback.has(id)) return;
    cancelPersistTimer(id);
    persistTimers.set(
        id,
        setTimeout(() => {
            persistTimers.delete(id);
            void writeScrollback(id);
        }, 500),
    );
}

/** Writes every scrollback still waiting on its timer: the shells outlive the service, and this is what they show next. */
async function flushScrollback(): Promise<void> {
    const waiting = [...persistTimers.keys()];
    for (const id of waiting) cancelPersistTimer(id);
    await Promise.all(waiting.map(writeScrollback));
}

// the Blocks panel's handle, and what it was last told changed
const blocks = blocksApi.panel(PANEL_ID);
const announcer = new BlocksAnnouncer(blocks);

function publishTabs(ctx: Ctx) {
    ctx.setState({ tabs: structuredClone(tabs), activeTabId, showTab: { ...showTabRequest }, layout, tabsError });
    announcer.list("tabs", tabs.map((t) => t.id));
    announcer.list("active-tab", [activeTabId]);
}

/**
 * Makes `change` to the tabs, saves them and shows the change, one change
 * at a time: no other change runs, saves or is shown between a change's
 * first step and its save. A change that throws, or a save that fails,
 * undoes the change and rejects with why, so nothing is shown that a restart
 * would lose; an unreadable tabs.json is never written over.
 */
function changeTabs(ctx: Ctx, change: () => void | Promise<void> = () => {}): Promise<void> {
    const saved = tabsSaving.then(async () => {
        if (tabsError) throw new Error(tabsError);
        const before = structuredClone({ tabs, activeTabId, layout, showTabRequest });
        try {
            await change();
            await config.set({ tabs, activeTabId, layout }, PANEL_ID, TABS_FILE).catch((err) => {
                throw new Error(`Your tabs could not be saved: ${errorMessage(err)}`);
            });
        } catch (err) {
            ({ tabs, activeTabId, layout, showTabRequest } = before);
            throw err;
        }
        publishTabs(ctx);
    });
    // the next change waits for this one, whichever way it ends
    tabsSaving = saved.then(
        () => undefined,
        () => undefined,
    );
    return saved;
}

function cancelPersistTimer(id: string) {
    const timer = persistTimers.get(id);
    if (timer) clearTimeout(timer);
    persistTimers.delete(id);
}

function liveSession(id: string): LiveSession {
    return (live[id] ??= { program: "", cwd: "" });
}

function publishLive() {
    serviceCtx?.setState({ live: structuredClone(live) });
}

function subscribeSession(id: string) {
    if (subscribedSessions.has(id)) return;
    subscribedSessions.add(id);
    try {
        const unsubs = [
            terminalApi.onData(id, (data) => {
                if (!findSession(tabs, id)) return;
                buffers.set(id, applyScrollbackCap(data, buffers.get(id) || ""));
                schedulePersist(id);
            }),
            terminalApi.onExit(id, (exitCode) => {
                // the program in front was the shell, and it is gone
                if (live[id]) {
                    live[id].program = "";
                    publishLive();
                }
                const owner = findSession(tabs, id);
                // a split's shell ending is not the tab's
                if (owner && owner.tab.id !== id) return;
                announcer.fire("terminal-exit", exitPayload(id, exitCode));
            }),
            terminalApi.onForeground(id, (program) => {
                if (!findSession(tabs, id)) return;
                liveSession(id).program = program;
                publishLive();
            }),
            terminalApi.onCwd(id, (cwd) => {
                const owner = findSession(tabs, id);
                if (!owner) return;
                liveSession(id).cwd = cwd;
                publishLive();
                // where the next shell for this session starts
                if (owner.session.cwd !== cwd && serviceCtx) {
                    changeTabs(serviceCtx, () => {
                        const now = findSession(tabs, id);
                        if (now) now.session.cwd = cwd;
                    }).then(
                        () => setSessionError(id, "folder", ""),
                        (err) => setSessionError(id, "folder", `${cwd} wasn't saved as this shell's folder, so its next shell may start somewhere else: ${errorMessage(err)}`),
                    );
                }
            }),
            terminalApi.onCommand(id, (finished) => {
                const owner = findSession(tabs, id);
                if (!owner) return;
                liveSession(id).command = { line: finished.command, exitCode: finished.exitCode, seq: ++commandSeq };
                publishLive();
                announcer.fire("command-finished", commandPayload(owner.tab.id, finished));
            }),
        ];
        sessionUnsubs.set(id, unsubs);
    } catch (err) {
        console.error(`[TerminalService] session subscription failed for ${id}:`, err);
    }
}

function unsubscribeSession(id: string) {
    // deallocated, not just guarded: drop the id AND detach the listeners
    // so a reconnect storm or daemon echo can't wake a dead tab
    subscribedSessions.delete(id);
    delete live[id];
    const unsubs = sessionUnsubs.get(id);
    sessionUnsubs.delete(id);
    for (const unsub of unsubs ?? []) {
        try {
            unsub();
        } catch (err) {
            console.error(`[TerminalService] session unsubscribe failed for ${id}:`, err);
        }
    }
}

// a requested pty size is usable only when both dimensions are positive
// integers; anything else means "no size given", never a resize to 0
function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
    return (
        typeof cols === "number" &&
        Number.isInteger(cols) &&
        cols > 0 &&
        typeof rows === "number" &&
        Number.isInteger(rows) &&
        rows > 0
    );
}

// throws with the daemon's reason when the session could not be probed or
// created: a shell that failed to start must reach the viewer, never pass as
// an empty scrollback, and a probe that failed is not a shell that is gone
// (taking it for one would wipe a live shell's scrollback)
async function ensureSession(id: string, cols?: number, rows?: number): Promise<void> {
    if (await terminalApi.exists(id)) {
        // an existing session keeps whatever size its pty was spawned or
        // last set to: a viewer returning with a different size (window
        // resized while away, fonts changed) would otherwise desync the
        // shell's line wrapping. Best-effort and loud — a failed resize
        // must not fail the open.
        if (isValidTerminalSize(cols, rows)) {
            try {
                await terminalApi.resize(id, cols as number, rows as number);
                setSessionError(id, "size", "");
            } catch (err) {
                setSessionError(id, "size", `This screen's size didn't reach the shell, so long lines may wrap wrong: ${errorMessage(err)}`);
            }
        }
        return;
    }
    // a new shell starts a new screen: the saved scrollback belonged to the
    // shell that ended (Paperboard quit, or the shell exited), and keeping it
    // glued each new prompt onto the last line of the old one
    cancelPersistTimer(id);
    forgetSessionErrors(id);
    const session = findSession(tabs, id)?.session;
    // it starts where the last one was, unless that folder has gone since
    let cwd = session?.cwd;
    let notice = "";
    if (cwd && !isFolder(cwd)) {
        notice = `\x1b[2m${cwd} is gone, so this shell starts in the home folder.\x1b[0m\r\n`;
        cwd = undefined;
        session!.cwd = undefined;
    }
    buffers.set(id, notice);
    await files.write(scrollbackPath(id), notice, PANEL_ID);
    await terminalApi.create(id, { cols, rows, cwd, shell: session?.shell });
}

/** Where tabs.json is on this computer, said whole so a person can find it. */
async function tabsFileWhere(): Promise<string> {
    try {
        return await files.getPath(TABS_FILE, PANEL_ID);
    } catch (err) {
        return `${TABS_FILE} (in Terminal's folder of Paperboard's data; its full path couldn't be found: ${errorMessage(err)})`;
    }
}

function isFolder(folder: string): boolean {
    try {
        return fs.statSync(folder).isDirectory();
    } catch (err) {
        console.debug(`[TerminalService] ${folder} is not an open folder:`, err);
        return false;
    }
}

// a folder a caller asked for, refused before any tab opens
function requireStart(start: { cwd?: string; shell?: string }): { cwd?: string; shell?: string } {
    const cwd = (start.cwd || "").trim() || undefined;
    const shell = (start.shell || "").trim() || undefined;
    if (cwd && !isFolder(cwd)) throw new Error(`${cwd} is not a folder on this computer`);
    return { cwd, shell };
}

// create-tab starts its shell ahead of any viewer; a shell that cannot
// start must not lose the tab. Opening the tab (open-tab) retries and
// reports the failure to the viewer.
async function tryEnsureSession(id: string): Promise<void> {
    try {
        await ensureSession(id);
    } catch (err) {
        console.error(`[TerminalService] session create failed for ${id}:`, err);
    }
}

function resolveTabId(input?: string): string {
    const clean = (input || "").trim();
    if (!clean) {
        throw new Error("Terminal tab id required");
    }
    const tab = tabs.find((t) => t.id === clean);
    if (tab) return tab.id;
    // an unknown/renamed id must REFUSE, never fall back to another
    // session: keystrokes silently landing in the wrong shell is the
    // worst kind of silent success for a terminal
    throw new Error(`Unknown terminal tab: ${clean}`);
}

// keystrokes must never vanish: a session that could not be created, or a
// write the daemon refused, fails the block
async function writeToTerminal(tabId: string | undefined, text: string | undefined): Promise<void> {
    const id = resolveTabId(tabId);
    try {
        await ensureSession(id);
    } catch (err) {
        throw new Error(`Terminal session "${id}" could not be created; keystrokes were not sent: ${errorMessage(err)}`);
    }
    await writeTerminal(id, text || "");
}

const SAVED_COMMANDS_FILE = "saved-commands.json";

// publishes into whichever service context is live; null until onInit
let serviceCtx: Ctx | null = null;

const savedCommands = new SavedCommands({
    load: () => config.get(PANEL_ID, SAVED_COMMANDS_FILE),
    save: async (doc) => {
        await config.set(doc, PANEL_ID, SAVED_COMMANDS_FILE);
    },
    // user-saved text through the platform one-shot shell, argv form: the
    // command is one argument, never spliced into another shell string
    start: async (procId, command) => {
        const shell = resolveOneShotShell();
        const res = await processApi.start({ id: procId, command: shell.command, args: [...shell.baseArgs, command] });
        if (!res?.success) throw new Error("the daemon did not start the process");
    },
    onExit: (procId, callback) => processApi.onExit(procId, callback),
    kill: (procId) => processApi.kill(procId),
    exists: (procId) => processApi.exists(procId),
    publish: (view) => {
        serviceCtx?.setState(view);
        announcer.list("saved-commands", view.savedCommands.map((c) => c.id));
    },
    onFinished: (command, outcome) => announcer.fire("saved-command-finished", finishedPayload(command, outcome)),
});

// the daemon stops this service with SIGTERM: the runs it started are its to
// end, not to leave running unwatched with their deadline lost, and what the
// shells printed last is written before it goes
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
        void Promise.allSettled([savedCommands.dispose(), flushScrollback()]).then(() => process.exit(0));
    });
}

// What the blocks and the panel's page both do: one implementation each.

function liveCtx(): Ctx {
    if (!serviceCtx) throw new Error("The terminal service is still starting");
    return serviceCtx;
}

function newSessionId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Opens a tab; its shell starts in the folder and with the shell given, or
 * the defaults. `besides` is a session whose folder the new shell starts in
 * (a new tab from the panel opens where you are): a folder that has gone
 * since is said in the new terminal, not refused.
 */
async function createTab(ctx: Ctx, label?: string, start: { cwd?: string; shell?: string; besides?: string } = {}): Promise<string> {
    // no shell starts for a tab that could not be saved
    if (tabsError) throw new Error(tabsError);
    const asked = requireStart(start);
    const shell = asked.shell;
    let cwd = asked.cwd;
    if (!cwd && start.besides) {
        const beside = findSession(tabs, start.besides);
        if (!beside) throw new Error(`Unknown terminal tab "${start.besides}"`);
        cwd = live[beside.session.id]?.cwd || beside.session.cwd;
    }
    const id = newSessionId("tab");
    const chosen = (label || "").trim();
    let name = "";
    let started = false;
    try {
        await changeTabs(ctx, async () => {
            name = chosen || `Tab ${tabs.length + 1}`;
            const tab: TerminalTab = { id, label: name };
            if (chosen) tab.named = true;
            if (cwd) tab.cwd = cwd;
            if (shell) tab.shell = shell;
            tabs.push(tab);
            activeTabId = id;
            // heard from its first prompt on
            subscribeSession(id);
            // a shell asked for by name must start, or the tab isn't opened:
            // the daemon says why (one this computer doesn't have)
            if (shell) await ensureSession(id);
            else await tryEnsureSession(id);
            started = true;
        });
    } catch (err) {
        // a tab that was not saved is not opened: its shell goes with it
        if (started) await endSession(id);
        else await dropSession(id);
        throw err;
    }
    announcer.fire("tab-opened", tabPayload({ id, label: name }));
    return id;
}

/** Opens a second shell beside the tab's, in the folder the first is in. */
async function splitTab(ctx: Ctx, tabId: string | undefined, direction: SplitDirection): Promise<string> {
    if (direction !== "right" && direction !== "down") throw new Error("A tab splits right or down");
    const id = newSessionId("pane");
    let made = false;
    try {
        await changeTabs(ctx, async () => {
            // the tab as it is now, after the changes queued before this one
            const tab = tabs.find((t) => t.id === resolveTabId(tabId))!;
            if (tab.split) throw new Error(`${tab.label} is split already`);
            const session: TerminalSession = { id };
            const cwd = live[tab.id]?.cwd || tab.cwd;
            if (cwd) session.cwd = cwd;
            if (tab.shell) session.shell = tab.shell;
            tab.split = { direction, session };
            made = true;
            subscribeSession(id);
            await tryEnsureSession(id);
        });
    } catch (err) {
        // a split that was not saved is not opened: its shell goes with it
        if (made) await endSession(id);
        throw err;
    }
    return id;
}

/** Ends the tab's second shell, and the tab is one shell again. */
async function unsplitTab(ctx: Ctx, tabId: string | undefined): Promise<void> {
    const tab = tabs.find((t) => t.id === resolveTabId(tabId))!;
    if (!tab.split) throw new Error(`${tab.label} is not split`);
    const id = tab.split.session.id;
    // a shell that would not stop keeps its pane, so it stays reachable
    await terminalApi.destroy(id);
    // a split that was not saved stays, and opening it starts a new shell
    await changeTabs(ctx, () => {
        const owner = tabs.find((t) => t.id === tab.id);
        if (owner) owner.split = undefined;
    });
    await dropSession(id);
}

/** Forgets a session whose shell is gone: its listeners, output and saved scrollback. */
async function dropSession(id: string): Promise<void> {
    buffers.delete(id);
    // teardown: detach listeners and drop the subscription id, then
    // cancel the pending debounce so no write fires for a dead session
    unsubscribeSession(id);
    cancelPersistTimer(id);
    forgetSessionErrors(id);
    await files.delete(scrollbackPath(id), PANEL_ID);
}

/** Ends a shell that was started for a tab or split that could not be saved. */
async function endSession(id: string): Promise<void> {
    await terminalApi.destroy(id).catch((err) => console.error(`[TerminalService] the unsaved session ${id} would not stop:`, err));
    await dropSession(id);
}

async function setLayout(ctx: Ctx, next: unknown): Promise<void> {
    if (next !== "horizontal" && next !== "vertical") throw new Error("Tabs are laid out horizontal or vertical");
    await changeTabs(ctx, () => {
        layout = next;
    });
}

async function renameTab(ctx: Ctx, id: string | undefined, label: string | undefined): Promise<void> {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) throw new Error(`Unknown terminal tab "${id}"`);
    const name = (label || "").trim();
    if (!name) throw new Error("Label is required");
    await changeTabs(ctx, () => {
        const now = tabs.find((t) => t.id === tab.id);
        if (!now) return;
        now.label = name;
        now.named = true;
    });
}

async function closeTab(ctx: Ctx, input: string | undefined): Promise<void> {
    const id = (input || "").trim();
    const closing = tabs.find((t) => t.id === id);
    if (!closing) throw new Error(`Unknown terminal tab "${input}"`);
    // a shell that would not stop keeps its tab, so it stays reachable
    for (const session of tabSessions(closing)) await terminalApi.destroy(session.id);
    // a close that was not saved keeps the tab, and opening it starts a new shell
    await changeTabs(ctx, () => {
        tabs = tabs.filter((t) => t.id !== id);
        if (activeTabId === id) activeTabId = tabs[0]?.id || "";
    });
    for (const session of tabSessions(closing)) await dropSession(session.id);
    announcer.fire("tab-closed", tabPayload(closing));
}

/** Puts the tabs in this order; it must be exactly the open tabs, none dropped. */
async function reorderTabs(ctx: Ctx, orderedIds: unknown): Promise<void> {
    const ids = Array.isArray(orderedIds) ? orderedIds.map((s) => String(s)) : [];
    const byId = new Map(tabs.map((t) => [t.id, t]));
    if (ids.length !== tabs.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
        throw new Error("reorder-tabs requires exactly the current tab ids");
    }
    await changeTabs(ctx, () => {
        tabs = ids.map((id) => byId.get(id)!);
    });
}

/** Moves a tab to a place in the tab bar, 1 being the first. */
async function moveTab(ctx: Ctx, tabId: string | undefined, position: number): Promise<void> {
    const id = resolveTabId(tabId);
    if (!Number.isInteger(position) || position < 1) throw new Error("Position must be a whole number of at least 1");
    if (position > tabs.length) {
        throw new Error(`Position ${position} is past the last tab; there ${tabs.length === 1 ? "is 1 tab" : `are ${tabs.length} tabs`}`);
    }
    const order = tabs.map((t) => t.id).filter((t) => t !== id);
    order.splice(position - 1, 0, id);
    await reorderTabs(ctx, order);
}

/** The tab last shown, which a new window opens on. */
function activeTab(): string {
    if (!tabs.some((t) => t.id === activeTabId)) throw new Error("No terminal tab is open");
    return activeTabId;
}

/** Switches every open window to the tab, and makes it the one a new window opens on. */
async function showTab(ctx: Ctx, tabId: string | undefined): Promise<void> {
    const id = resolveTabId(tabId);
    await changeTabs(ctx, () => {
        activeTabId = id;
        showTabRequest = { id, request: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` };
    });
}

/** The tab's last whole lines, 1 to 1000 of them (100 when not given). */
function readOutput(tabId: string | undefined, lines?: number): string {
    return readWholeLines(buffers.get(resolveTabId(tabId)) || "", lines);
}

function tabLabel(id: string): string {
    const known = resolveTabId(id);
    return tabs.find((t) => t.id === known)!.label;
}

function savedCommand(id: string): SavedCommand {
    const command = savedCommands.view().savedCommands.find((c) => c.id === id);
    if (!command) throw new Error(`No saved command "${id}"; it may have been removed`);
    return command;
}

// what the panel's own page asks the service; the same things a person
// automates are blocks (blocks.ts)
const calls = {
    "create-tab": (ctx: Ctx, input: { label?: string; cwd?: string; shell?: string; besides?: string }) =>
        createTab(ctx, input?.label, { cwd: input?.cwd, shell: input?.shell, besides: input?.besides }),
    "split-tab": (ctx: Ctx, input: { id: string; direction?: SplitDirection }) => splitTab(ctx, input?.id, input?.direction ?? "right"),
    "unsplit-tab": (ctx: Ctx, input: { id: string }) => unsplitTab(ctx, input?.id),
    "set-tab-layout": (ctx: Ctx, input: { layout: TabLayout }) => setLayout(ctx, input?.layout),
    // attaches the page to a session and gives back its scrollback
    "open-tab": async (ctx: Ctx, input: { id: string; cols?: number; rows?: number }) => {
        const id = (input?.id || "").trim();
        const owner = findSession(tabs, id);
        if (!owner) {
            throw new Error(`Unknown terminal tab "${input?.id}"`);
        }
        await ensureSession(id, input?.cols, input?.rows);
        subscribeSession(id);
        await changeTabs(ctx, () => {
            activeTabId = owner.tab.id;
        });
        return buffers.get(id) || "";
    },
    "rename-tab": (ctx: Ctx, input: { id: string; label: string }) => renameTab(ctx, input?.id, input?.label),
    "close-tab": (ctx: Ctx, input: { id: string }) => closeTab(ctx, input?.id),
    "reorder-tabs": (ctx: Ctx, input: { orderedIds?: string[] }) => reorderTabs(ctx, input?.orderedIds),
    // the tab the page last showed is the one a new window opens on
    "touch-tab": async (ctx: Ctx, input: { id: string }) => {
        const id = (input?.id || "").trim();
        if (!tabs.some((t) => t.id === id)) return false;
        await changeTabs(ctx, () => {
            activeTabId = id;
        });
        return true;
    },
    "save-command": (_ctx: Ctx, input: { label?: string; command?: string }) => savedCommands.add(input?.label, input?.command),
    "remove-saved-command": (_ctx: Ctx, input: { id?: string }) => savedCommands.remove(input?.id),
    "run-saved-command": (_ctx: Ctx, input: { id?: string }) => savedCommands.run(input?.id),
};

export default definePanelService({
    id: PANEL_ID,
    state: {
        tabs: [] as TerminalTab[],
        activeTabId: "",
        live: {} as Record<string, LiveSession>,
        layout: "horizontal" as TabLayout,
        showTab: { id: "", request: "" },
        savedCommands: [] as SavedCommand[],
        commandRuns: {} as Record<string, CommandRun>,
        savedCommandsError: "",
        tabsError: "",
        sessionErrors: {} as SessionErrors,
    },
    // Home's gallery: the "Command" dropdown of the Pinned command widget
    widgetChoices: {
        "pinned-command": {
            command: () => savedCommands.choices(),
        },
    },
    calls,
    async onInit(ctx: Ctx) {
        serviceCtx = ctx;
        await savedCommands.init();

        try {
            const saved = await config.get<any>(PANEL_ID, TABS_FILE);
            tabs = readSavedTabs(saved?.tabs);
            layout = readLayout(saved?.layout);
            if (typeof saved?.activeTabId === "string") {
                activeTabId = saved.activeTabId;
            }
        } catch (err) {
            // unreadable is not empty: no tab opens over it, and nothing writes over it
            tabsError = `${await tabsFileWhere()} could not be read (${errorMessage(err)}), so Terminal won't open a tab over it. Repair or move that file, then restart Paperboard.`;
            console.error("[TerminalService] Failed to load tabs:", err);
        }

        for (const session of tabs.flatMap(tabSessions)) {
            try {
                const saved = await files.read(scrollbackPath(session.id), PANEL_ID);
                if (saved) {
                    buffers.set(session.id, saved.slice(-SCROLLBACK_CHARS));
                }
            } catch (err) {
                unreadScrollback.add(session.id);
                setSessionError(session.id, "scrollback", `This shell's earlier output couldn't be read, so it isn't shown, and what it prints now isn't saved over it: ${errorMessage(err)}`);
            }
            subscribeSession(session.id);
        }

        if (tabs.length === 0 && !tabsError) {
            // a first tab that could not be saved is not opened; the page
            // opens one when it finds none, and says why that fails
            await changeTabs(ctx, () => {
                tabs.push({ id: "tab1", label: "Tab 1" });
                activeTabId = "tab1";
            }).then(
                () => subscribeSession("tab1"),
                (err) => console.error("[TerminalService] the first tab was not saved:", err),
            );
        } else if (tabs.length > 0 && !tabs.some((t) => t.id === activeTabId)) {
            activeTabId = tabs[0].id;
        }
        // No shell is started here: a tab's shell starts when the tab is
        // opened or written to. Shells still running from before this service
        // started are heard through the subscriptions above.

        await announcer.register(
            terminalBlocks({
                tabs: () => tabs.map((t) => t.id),
                tabLabel,
                activeTab,
                showTab: (id) => showTab(liveCtx(), id),
                moveTab: (id, position) => moveTab(liveCtx(), id, position),
                createTab: (label, folder) => createTab(liveCtx(), label, { cwd: folder }),
                tabProgram: (id) => live[resolveTabId(id)]?.program ?? "",
                tabFolder: (id) => {
                    const tab = tabs.find((t) => t.id === resolveTabId(id))!;
                    return live[tab.id]?.cwd || tab.cwd || "";
                },
                tabSplit: (id) => Boolean(tabs.find((t) => t.id === resolveTabId(id))!.split),
                splitTab: async (id, direction) => void (await splitTab(liveCtx(), id, direction)),
                unsplitTab: (id) => unsplitTab(liveCtx(), id),
                renameTab: (id, label) => renameTab(liveCtx(), id, label),
                closeTab: (id) => closeTab(liveCtx(), id),
                write: writeToTerminal,
                readOutput,
                runShellCommand: (command) => runShellCommand(command),
                savedCommands: () => savedCommands.view().savedCommands.map((c) => c.id),
                savedCommand,
                savedCommandRunning: (id) => savedCommands.view().commandRuns[savedCommand(id).id]?.state === "running",
                savedCommandRun: (id) => savedCommands.view().commandRuns[savedCommand(id).id],
                saveCommand: (label, command) => savedCommands.add(label, command),
                removeSavedCommand: (id) => savedCommands.remove(id),
                runSavedCommand: async (id) => void (await savedCommands.run(id)),
                stopSavedCommand: (id) => savedCommands.stop(id),
            }),
            { tabs: tabs.map((t) => t.id), "active-tab": [activeTabId], "saved-commands": savedCommands.view().savedCommands.map((c) => c.id) },
        );
        publishTabs(ctx);
        ctx.setState({ sessionErrors: structuredClone(sessionErrors) });
        console.log(`[TerminalService] Ready with ${tabs.length} persistent session(s).`);
    },
});
