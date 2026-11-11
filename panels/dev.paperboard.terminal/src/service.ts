import {
    definePanelService,
    defineAction,
    config,
    terminalApi,
    processApi,
    files,
    resolveOneShotShell,
    blocksApi,
    actionsApi,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import { SCROLLBACK_CHARS, applyScrollbackCap, readWholeLines } from "./lib/scrollback";
import { errorMessage } from "./lib/failure";
import { runShellCommand } from "./lib/shellCommand";
import { writeTerminal } from "./lib/terminalWrite";
import { SavedCommands, type CommandRun, type SavedCommand } from "./lib/savedCommands";
import { BlocksAnnouncer, exitPayload, finishedPayload, tabPayload, terminalBlocks } from "./blocks";

// pass PANEL_ID explicitly, ambient scope resolves to last-imported panel
const PANEL_ID = "dev.paperboard.terminal";

export interface TerminalTab {
    id: string;
    label: string;
}

export interface TerminalServiceState {
    // the tab list every window mirrors; which tab a window shows is that
    // window's own choice, so open windows and computers stay in step
    tabs: TerminalTab[];
    activeTabId: string;
    // Show Tab's request that every open window switch to a tab; each request
    // has its own token, so a window follows it once
    showTab: { id: string; request: string };
    // saved commands (run from Home's "Pinned command" widget) and the last
    // observed outcome of each
    savedCommands: SavedCommand[];
    commandRuns: Record<string, CommandRun>;
    savedCommandsError: string;
}

type Ctx = ServiceContext<TerminalServiceState>;

const SCROLLBACK_DIR = "terminal-scrollback";

let tabs: TerminalTab[] = [];
let activeTabId = "";
let showTabRequest = { id: "", request: "" };

const buffers = new Map<string, string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscribedSessions = new Set<string>();
// teardown handles for the listeners above: a closed tab must detach, not
// just hide behind the tabs.some() guard inside the callbacks
const sessionUnsubs = new Map<string, Array<() => void>>();
// tabs whose shell is running, as far as this service knows: the daemon said
// so, or this service started it and has not heard it exit. One that could
// not be checked counts, so its output is never left uncaptured.
const liveSessions = new Set<string>();
// what this service sent the daemon that nobody waits for (an event, a
// scrollback write) and has not landed yet
let unsettled = 0;
// the tabs are read and the running shells taken back: until then the service is starting, not idle
let started = false;

/**
 * Says whether the service has nothing to do until an action calls it: no
 * shell whose output and exit it must hear, no scrollback waiting to be
 * written, no saved command running or being recorded, and nothing still on
 * its way to the daemon. Called after every change to any of those.
 */
function updateIdle(): void {
    serviceCtx?.setIdle(started && liveSessions.size === 0 && persistTimers.size === 0 && unsettled === 0 && !savedCommands.busy());
}

function setLive(id: string, live: boolean): void {
    if (live) liveSessions.add(id);
    else liveSessions.delete(id);
    updateIdle();
}

/** Keeps the service awake until `work`, which nobody waits for, has ended. */
function settling(work: Promise<unknown>): void {
    unsettled++;
    updateIdle();
    work.finally(() => {
        unsettled--;
        updateIdle();
    });
}

function scrollbackPath(id: string): string {
    return `${SCROLLBACK_DIR}/${id}.log`;
}

function schedulePersist(id: string) {
    const existing = persistTimers.get(id);
    if (existing) clearTimeout(existing);
    persistTimers.set(
        id,
        setTimeout(() => {
            persistTimers.delete(id);
            settling(files.write(scrollbackPath(id), buffers.get(id) || "", PANEL_ID).catch((err) =>
                console.error(`[TerminalService] scrollback persist failed for ${id}:`, err),
            ));
        }, 500),
    );
}

// the Blocks panel's handle, and what it was last told changed
const blocks = blocksApi.panel(PANEL_ID);
const announcer = new BlocksAnnouncer(blocks);

function publishTabs(ctx: Ctx) {
    ctx.setState({ tabs: tabs.map((t) => ({ ...t })), activeTabId, showTab: { ...showTabRequest } });
    announcer.list("tabs", tabs.map((t) => t.id));
    announcer.list("active-tab", [activeTabId]);
}

async function persistTabs(ctx: Ctx | null) {
    try {
        await config.set({ tabs, activeTabId }, PANEL_ID, "tabs.json");
    } catch (err) {
        console.error("[TerminalService] tab config persist failed:", err);
    }
    if (ctx) publishTabs(ctx);
}

function cancelPersistTimer(id: string) {
    const timer = persistTimers.get(id);
    if (timer) clearTimeout(timer);
    persistTimers.delete(id);
    updateIdle();
}

export function subscribeSession(id: string, ctx: Ctx | null) {
    if (subscribedSessions.has(id)) return;
    subscribedSessions.add(id);
    try {
        const unsubs = [
            terminalApi.onData(id, (data) => {
                if (!tabs.some((t) => t.id === id)) return;
                buffers.set(id, applyScrollbackCap(data, buffers.get(id) || ""));
                schedulePersist(id);
            }),
            terminalApi.onExit(id, (exitCode) => {
                if (ctx) {
                    settling(actionsApi.emitTrigger("terminal-exit", { tabId: id, exitCode }, PANEL_ID).catch((err) =>
                        console.error("[TerminalService] Failed to emit trigger 'terminal-exit':", err),
                    ));
                }
                settling(announcer.fire("terminal-exit", exitPayload(id, exitCode)));
                setLive(id, false);
            }),
        ];
        sessionUnsubs.set(id, unsubs);
    } catch (err) {
        console.error(`[TerminalService] session subscription failed for ${id}:`, err);
    }
}

export function unsubscribeSession(id: string) {
    // deallocated, not just guarded: drop the id AND detach the listeners
    // so a reconnect storm or daemon echo can't wake a dead tab
    subscribedSessions.delete(id);
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

export function __terminalTestState() {
    return {
        subscribedCount: subscribedSessions.size,
        isSubscribed: (id: string) => subscribedSessions.has(id),
        // test hooks only: observe (and for targeting tests, seed) the
        // module-level tab list; never used by the runtime paths above
        tabIds: () => tabs.map((t) => t.id),
        registerTabForTest: (id: string) => tabs.push({ id, label: id }),
        actionForTest: (id: string) => actions.find((a) => a.id === id),
        clearTabsForTest: () => {
            const prior = tabs;
            tabs = [];
            return prior.map((t) => t.id);
        },
    };
}

// a requested pty size is usable only when both dimensions are positive
// integers; anything else means "no size given", never a resize to 0
export function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
    return (
        typeof cols === "number" &&
        Number.isInteger(cols) &&
        cols > 0 &&
        typeof rows === "number" &&
        Number.isInteger(rows) &&
        rows > 0
    );
}

// throws when the session could not be probed AND not created, carrying
// the daemon's reason (a shell that failed to start must reach the viewer,
// never pass as an empty scrollback)
async function ensureSession(id: string, cols?: number, rows?: number): Promise<void> {
    let exists = false;
    try {
        exists = await terminalApi.exists(id);
    } catch (err) {
        console.error(`[TerminalService] session probe failed for ${id}:`, err);
        // it may be running: counted as live until it is heard to exit
        setLive(id, true);
    }
    if (exists) {
        setLive(id, true);
        // an existing session keeps whatever size its pty was spawned or
        // last set to: a viewer returning with a different size (window
        // resized while away, fonts changed) would otherwise desync the
        // shell's line wrapping. Best-effort and loud — a failed resize
        // must not fail the open.
        if (isValidTerminalSize(cols, rows)) {
            try {
                await terminalApi.resize(id, cols as number, rows as number);
            } catch (err) {
                console.error(`[TerminalService] session resize failed for ${id}:`, err);
            }
        }
        return;
    }
    // a new shell starts a new screen: the saved scrollback belonged to the
    // shell that ended (Paperboard quit, or the shell exited), and keeping it
    // glued each new prompt onto the last line of the old one
    cancelPersistTimer(id);
    buffers.set(id, "");
    await files.write(scrollbackPath(id), "", PANEL_ID);
    await terminalApi.create(id, { cols, rows });
    setLive(id, true);
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
    return resolveTabIdPure(input, tabs);
}

// pure form: exported for tests, used by resolveTabId
export function resolveTabIdPure(
    input: string | undefined,
    tabList: TerminalTab[],
): string {
    const clean = (input || "").trim();
    if (!clean) {
        throw new Error("Terminal tab id required");
    }
    const tab = tabList.find((t) => t.id === clean);
    if (tab) return tab.id;
    // an unknown/renamed id must REFUSE, never fall back to another
    // session: keystrokes silently landing in the wrong shell is the
    // worst kind of silent success for a terminal
    throw new Error(`Unknown terminal tab: ${clean}`);
}

// One-shot shell resolution lives in PaperAPI (shared with the actions
// panel) — re-exported here so existing imports keep working. One
// invariant, one implementation.
export { resolveOneShotShell };

// keystrokes must never vanish: a session that could not be created, or a
// write the daemon refused, fails the action instead of returning true
export async function writeToTerminal(
    _ctx: Ctx,
    inputs?: { tabId?: string; text?: string },
): Promise<boolean> {
    const id = resolveTabId(inputs?.tabId);
    try {
        await ensureSession(id);
    } catch (err) {
        throw new Error(`Terminal session "${id}" could not be created; keystrokes were not sent: ${errorMessage(err)}`);
    }
    await writeTerminal(id, inputs?.text || "");
    return true;
}

const SAVED_COMMANDS_FILE = "saved-commands.json";

// publishes into whichever service context is live; null until onInit
let serviceCtx: Ctx | null = null;

export const savedCommands = new SavedCommands({
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
    onFinished: (command, outcome) => settling(announcer.fire("saved-command-finished", finishedPayload(command, outcome))),
    onBusyChange: () => updateIdle(),
});

// the daemon stops this service with SIGTERM: the runs it started are its to
// end, not to leave running unwatched with their deadline lost
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
        savedCommands.dispose().finally(() => process.exit(0));
    });
}

// What the actions (v1) and the blocks (v2) both do: one implementation each.

function liveCtx(): Ctx {
    if (!serviceCtx) throw new Error("The terminal service is still starting");
    return serviceCtx;
}

export async function createTab(ctx: Ctx, label?: string): Promise<string> {
    const id = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const name = (label || "").trim() || `Tab ${tabs.length + 1}`;
    tabs.push({ id, label: name });
    activeTabId = id;
    await tryEnsureSession(id);
    subscribeSession(id, ctx);
    await persistTabs(ctx);
    announcer.fire("tab-opened", tabPayload({ id, label: name }));
    return id;
}

export async function renameTab(ctx: Ctx, id: string | undefined, label: string | undefined): Promise<void> {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) throw new Error(`Unknown terminal tab "${id}"`);
    const name = (label || "").trim();
    if (!name) throw new Error("Label is required");
    tab.label = name;
    await persistTabs(ctx);
}

export async function closeTab(ctx: Ctx, input: string | undefined): Promise<void> {
    const id = (input || "").trim();
    const closing = tabs.find((t) => t.id === id);
    if (!closing) throw new Error(`Unknown terminal tab "${input}"`);
    // a shell that would not stop keeps its tab, so it stays reachable
    await terminalApi.destroy(id);
    tabs = tabs.filter((t) => t.id !== id);
    liveSessions.delete(id);
    buffers.delete(id);
    // teardown: detach listeners and drop the subscription id, then
    // cancel the pending debounce so no write fires for a dead tab
    unsubscribeSession(id);
    cancelPersistTimer(id);
    await files.delete(scrollbackPath(id), PANEL_ID);
    if (activeTabId === id) activeTabId = tabs[0]?.id || "";
    await persistTabs(ctx);
    announcer.fire("tab-closed", tabPayload(closing));
}

/** Puts the tabs in this order; it must be exactly the open tabs, none dropped. */
export async function reorderTabs(ctx: Ctx, orderedIds: unknown): Promise<void> {
    const ids = Array.isArray(orderedIds) ? orderedIds.map((s) => String(s)) : [];
    const byId = new Map(tabs.map((t) => [t.id, t]));
    if (ids.length !== tabs.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
        throw new Error("reorder-tabs requires exactly the current tab ids");
    }
    tabs = ids.map((id) => byId.get(id)!);
    await persistTabs(ctx);
}

/** Moves a tab to a place in the tab bar, 1 being the first. */
export async function moveTab(ctx: Ctx, tabId: string | undefined, position: number): Promise<void> {
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
export async function showTab(ctx: Ctx, tabId: string | undefined): Promise<void> {
    const id = resolveTabId(tabId);
    activeTabId = id;
    showTabRequest = { id, request: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` };
    await persistTabs(ctx);
}

/** The tab's last whole lines, 1 to 1000 of them (100 when not given). */
export function readOutput(tabId: string | undefined, lines?: number): string {
    const id = resolveTabId(tabId);
    const count = Math.max(1, Math.min(1000, Math.trunc(Number(lines ?? 100))));
    return readWholeLines(buffers.get(id) || "", count);
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

const actions = [
    defineAction({
        id: "list-tabs",
        name: "List Terminal Tabs",
        category: "Sessions",
        description: "Lists persistent terminal sessions",
        template: "List terminal tabs",
        inputs: {},
        output: { type: "object", label: "Tabs" },
        icon: "terminal",
        run: async () => tabs.map((t) => ({ ...t })),
    }),

    defineAction({
        id: "create-tab",
        name: "Create Terminal Tab",
        category: "Sessions",
        description: "Creates a persistent terminal session",
        template: "Create terminal tab {label}",
        inputs: {
            label: { type: "string", label: "Label", placeholder: "Label" },
        },
        output: { type: "string", label: "Tab ID" },
        icon: "add",
        run: async (ctx: Ctx, inputs: { label?: string }) => createTab(ctx, inputs?.label),
    }),

    defineAction({
        id: "open-tab",
        name: "Open Terminal Tab",
        category: "Sessions",
        description: "Attaches to a session and returns its scrollback",
        template: "Open terminal tab {id}",
        inputs: {
            id: { type: "string", label: "Tab ID", placeholder: "Tab ID", required: true },
            cols: { type: "number", label: "Columns", placeholder: "Columns" },
            rows: { type: "number", label: "Rows", placeholder: "Rows" },
        },
        output: { type: "string", label: "Scrollback" },
        icon: "open_in_new",
        run: async (ctx: Ctx, inputs: { id: string; cols?: number; rows?: number }) => {
            const id = (inputs?.id || "").trim();
            if (!tabs.some((t) => t.id === id)) {
                throw new Error(`Unknown terminal tab "${inputs?.id}"`);
            }
            activeTabId = id;
            await ensureSession(id, inputs?.cols, inputs?.rows);
            subscribeSession(id, ctx);
            await persistTabs(ctx);
            return buffers.get(id) || "";
        },
    }),

    defineAction({
        id: "rename-tab",
        name: "Rename Terminal Tab",
        category: "Sessions",
        description: "Renames a persistent terminal session",
        template: "Rename terminal tab to {label}",
        inputs: {
            id: { type: "string", label: "Tab ID", placeholder: "Tab ID", required: true },
            label: { type: "string", label: "Label", placeholder: "Label", required: true },
        },
        output: { type: "boolean", label: "Success" },
        icon: "edit",
        run: async (ctx: Ctx, inputs: { id: string; label: string }) => {
            await renameTab(ctx, inputs?.id, inputs?.label);
            return true;
        },
    }),

    defineAction({
        id: "close-tab",
        name: "Close Terminal Tab",
        category: "Sessions",
        description: "Destroys a terminal session and its scrollback",
        template: "Close terminal tab {id}",
        inputs: {
            id: { type: "string", label: "Tab ID", placeholder: "Tab ID", required: true },
        },
        output: { type: "boolean", label: "Success" },
        icon: "close",
        run: async (ctx: Ctx, inputs: { id: string }) => {
            await closeTab(ctx, inputs?.id);
            return true;
        },
    }),

    defineAction({
        id: "reorder-tabs",
        name: "Reorder Terminal Tabs",
        category: "Sessions",
        // the tab bar drives this; flows should never see it
        internal: true,
        description: "Persists a new tab order (drag / rearrange)",
        template: "Reorder terminal tabs as {orderedIds}",
        inputs: {
            orderedIds: { type: "array", label: "Ordered tab ids" },
        },
        output: { type: "boolean", label: "Success" },
        icon: "reorder",
        run: async (ctx: Ctx, inputs: { orderedIds?: string[] }) => {
            await reorderTabs(ctx, inputs?.orderedIds);
            return true;
        },
    }),

    defineAction({
        id: "touch-tab",
        name: "Touch Terminal Tab",
        category: "Sessions",
        description: "Marks a tab as most recently used",
        template: "Touch terminal tab {id}",
        inputs: {
            id: { type: "string", label: "Tab ID", placeholder: "Tab ID", required: true },
        },
        output: { type: "boolean", label: "Success" },
        icon: "touch_app",
        run: async (ctx: Ctx, inputs: { id: string }) => {
            const id = (inputs?.id || "").trim();
            if (!tabs.some((t) => t.id === id)) return false;
            activeTabId = id;
            await persistTabs(ctx);
            return true;
        },
    }),

    defineAction({
        id: "write-to-terminal",
        name: "Write to Terminal",
        category: "Input",
        description: "Sends keystrokes to a live terminal session",
        template: "Write {text} to terminal {tabId}",
        inputs: {
            tabId: { type: "string", label: "Tab", placeholder: "Tab" },
            text: { type: "string", label: "Text", placeholder: "Text", required: true },
        },
        output: { type: "boolean", label: "Success" },
        icon: "keyboard",
        run: async (_ctx: Ctx, inputs: { tabId?: string; text: string }) => writeToTerminal(_ctx, inputs),
    }),

    defineAction({
        id: "read-terminal-buffer",
        name: "Read Terminal Output",
        category: "Output",
        description: "Returns the last lines of a terminal session",
        template: "Read last {lines} lines of terminal {tabId}",
        inputs: {
            tabId: { type: "string", label: "Tab", placeholder: "Tab" },
            lines: { type: "number", label: "Lines", placeholder: "Lines" },
        },
        output: { type: "string", label: "Output" },
        icon: "article",
        run: async (_ctx: Ctx, inputs: { tabId?: string; lines?: number }) => readOutput(inputs?.tabId, inputs?.lines),
    }),

    defineAction({
        id: "run-terminal-command",
        name: "Run Shell Command",
        category: "Input",
        description: "Runs a one-shot shell command and returns its standard output; fails if the command exits with an error",
        template: "Run shell command {command}",
        inputs: {
            command: { type: "string", label: "Command", placeholder: "Command", required: true },
        },
        output: { type: "string", label: "Output" },
        icon: "terminal",
        run: async (_ctx: Ctx, inputs: { command: string }) => runShellCommand(inputs?.command),
    }),

    defineAction({
        id: "list-saved-commands",
        name: "List Saved Commands",
        category: "Saved commands",
        description: "Lists the commands saved in the Terminal panel",
        template: "List saved commands",
        inputs: {},
        output: { type: "object", label: "Commands" },
        icon: "bookmarks",
        run: async () => savedCommands.view().savedCommands,
    }),

    defineAction({
        id: "save-command",
        name: "Save Command",
        category: "Saved commands",
        description: "Saves a shell command to run later from the panel or Home",
        template: "Save command {command} as {label}",
        inputs: {
            label: { type: "string", label: "Name", placeholder: "Name" },
            command: { type: "string", label: "Command", placeholder: "Command", required: true },
        },
        output: { type: "string", label: "Command ID" },
        icon: "bookmark_add",
        run: async (_ctx: Ctx, inputs: { label?: string; command?: string }) =>
            savedCommands.add(inputs?.label, inputs?.command),
    }),

    defineAction({
        id: "remove-saved-command",
        name: "Remove Saved Command",
        category: "Saved commands",
        description: "Removes a saved command; widgets that run it show it as gone",
        template: "Remove saved command {id}",
        inputs: {
            id: { type: "string", label: "Command ID", placeholder: "Command ID", required: true },
        },
        output: { type: "boolean", label: "Success" },
        icon: "bookmark_remove",
        run: async (_ctx: Ctx, inputs: { id?: string }) => {
            await savedCommands.remove(inputs?.id);
            return true;
        },
    }),

    defineAction({
        id: "run-saved-command",
        name: "Run Saved Command",
        category: "Saved commands",
        description: "Starts a saved command; its exit status arrives when the process exits",
        template: "Run saved command {id}",
        inputs: {
            id: { type: "string", label: "Command ID", placeholder: "Command ID", required: true },
        },
        output: { type: "object", label: "Run" },
        icon: "play_arrow",
        run: async (_ctx: Ctx, inputs: { id?: string }) => savedCommands.run(inputs?.id),
    }),
];

// event actions fire as events and start flows; they are not callable
const eventActions = [
    defineAction({
        id: "terminal-exit",
        name: "When Terminal Session Ends",
        category: "Events",
        description: "Fires when a terminal shell process exits",
        template: "When terminal session ends",
        output: { type: "object", label: "Session" },
        icon: "logout",
    }),
];

export const terminalService = definePanelService({
    id: "dev.paperboard.terminal",
    state: {
        tabs: [] as TerminalTab[],
        activeTabId: "",
        showTab: { id: "", request: "" },
        savedCommands: [] as SavedCommand[],
        commandRuns: {} as Record<string, CommandRun>,
        savedCommandsError: "",
    },
    // Home's gallery: the "Command" dropdown of the Pinned command widget
    widgetChoices: {
        "pinned-command": {
            command: () => savedCommands.choices(),
        },
    },
    categories: [
        { name: "Sessions", icon: "terminal", order: 1 },
        { name: "Input", icon: "keyboard", order: 2 },
        { name: "Output", icon: "output", order: 3 },
        { name: "Saved commands", icon: "bookmarks", order: 4 },
        { name: "Events", icon: "bolt", order: 5 },
    ],
    actions: [...actions, ...eventActions],
    async onInit(ctx: Ctx) {
        serviceCtx = ctx;
        await savedCommands.init();

        try {
            const saved = await config.get<any>(PANEL_ID, "tabs.json");
            if (saved?.tabs && Array.isArray(saved.tabs)) {
                tabs = saved.tabs.filter(
                    (t: any) => t && typeof t.id === "string" && typeof t.label === "string",
                );
            }
            if (typeof saved?.activeTabId === "string") {
                activeTabId = saved.activeTabId;
            }
        } catch (err) {
            console.error("[TerminalService] Failed to load tabs:", err);
        }

        for (const tab of tabs) {
            try {
                const saved = await files.read(scrollbackPath(tab.id), PANEL_ID);
                if (saved) {
                    buffers.set(tab.id, saved.slice(-SCROLLBACK_CHARS));
                }
            } catch (err) {
                console.error(`[TerminalService] scrollback restore failed for ${tab.id}:`, err);
            }
            subscribeSession(tab.id, ctx);
        }

        if (tabs.length === 0) {
            tabs.push({ id: "tab1", label: "Tab 1" });
            activeTabId = "tab1";
            subscribeSession("tab1", ctx);
            await persistTabs(ctx);
        } else if (!tabs.some((t) => t.id === activeTabId)) {
            activeTabId = tabs[0].id;
        }
        // No shell is started here: a tab's shell starts when the tab is
        // opened or written to. The shells still running from before this
        // service started are found, so they are heard again.
        for (const tab of tabs) {
            try {
                if (await terminalApi.exists(tab.id)) setLive(tab.id, true);
            } catch (err) {
                console.error(`[TerminalService] session probe failed for ${tab.id}:`, err);
                // it may be running: counted as live until it is heard to exit
                setLive(tab.id, true);
            }
        }

        await announcer.register(
            terminalBlocks({
                tabs: () => tabs.map((t) => t.id),
                tabLabel,
                activeTab,
                showTab: (id) => showTab(liveCtx(), id),
                moveTab: (id, position) => moveTab(liveCtx(), id, position),
                createTab: (label) => createTab(liveCtx(), label),
                renameTab: (id, label) => renameTab(liveCtx(), id, label),
                closeTab: (id) => closeTab(liveCtx(), id),
                write: (id, text) => writeToTerminal(liveCtx(), { tabId: id, text }),
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
        started = true;
        updateIdle();
        console.log(`[TerminalService] Ready with ${tabs.length} persistent session(s).`);
    },
});

export default terminalService;
