import {
    definePanelService,
    defineAction,
    config,
    terminalApi,
    processApi,
    files,
    resolveOneShotShell,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { SCROLLBACK_CHARS, applyScrollbackCap, readWholeLines } from "./lib/scrollback";

// pass PANEL_ID explicitly, ambient scope resolves to last-imported panel
const PANEL_ID = "dev.paperboard.terminal";

interface TerminalTab {
    id: string;
    label: string;
}

interface TerminalServiceState {
    tabCount: number;
    activeTabId: string;
}

type Ctx = ServiceContext<TerminalServiceState>;

const SCROLLBACK_DIR = "terminal-scrollback";

let tabs: TerminalTab[] = [];
let activeTabId = "";
let lastActiveId = "";

const buffers = new Map<string, string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscribedSessions = new Set<string>();
// teardown handles for the listeners above: a closed tab must detach, not
// just hide behind the tabs.some() guard inside the callbacks
const sessionUnsubs = new Map<string, Array<() => void>>();

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
            files.write(scrollbackPath(id), buffers.get(id) || "", PANEL_ID).catch((err) =>
                console.error(`[TerminalService] scrollback persist failed for ${id}:`, err),
            );
        }, 500),
    );
}

function updateCounts(ctx: Ctx) {
    ctx.setState({ tabCount: tabs.length, activeTabId });
}

async function persistTabs(ctx: Ctx | null) {
    try {
        await config.set({ tabs, activeTabId }, PANEL_ID, "tabs.json");
    } catch (err) {
        console.error("[TerminalService] tab config persist failed:", err);
    }
    if (ctx) updateCounts(ctx);
}

function cancelPersistTimer(id: string) {
    const timer = persistTimers.get(id);
    if (timer) clearTimeout(timer);
    persistTimers.delete(id);
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
                buffers.delete(id);
                ctx?.emitTrigger("terminal-exit", { tabId: id, exitCode });
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

// returns false when the session could not be probed AND not created:
// keystrokes must never be sent into a void and reported as delivered
async function ensureSession(id: string, cols?: number, rows?: number): Promise<boolean> {
    let exists = false;
    try {
        exists = await terminalApi.exists(id);
    } catch (err) {
        console.error(`[TerminalService] session probe failed for ${id}:`, err);
    }
    if (exists) {
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
        return true;
    }
    try {
        await terminalApi.create(id, { cols, rows });
        return true;
    } catch (err) {
        console.error(`[TerminalService] session create failed for ${id}:`, err);
        return false;
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

// keystrokes must never vanish: a session that could not be created makes
// the action FAIL with a typed error, not return true into the void
export async function writeToTerminal(
    _ctx: Ctx,
    inputs?: { tabId?: string; text?: string },
): Promise<boolean> {
    const id = resolveTabId(inputs?.tabId);
    const ready = await ensureSession(id);
    let live = ready;
    if (live) {
        // verify the session is actually live: an unacknowledged create
        // must not pass as ready and swallow the keystrokes
        try {
            live = await terminalApi.exists(id);
        } catch (err) {
            console.error(`[TerminalService] session verify failed for ${id}:`, err);
            live = false;
        }
    }
    if (!live) {
        throw new Error(
            `Terminal session "${id}" could not be created; keystrokes were not sent`,
        );
    }
    terminalApi.write(id, inputs?.text || "");
    return true;
}

// A failed recovery copy must leave the live source intact.
export async function trashScrollback(id: string): Promise<void> {
    try {
        const saved = await files.read(scrollbackPath(id), PANEL_ID);
        if (saved) {
            const trashName = trashScrollbackName(id);
            try {
                await files.write(trashName, saved, PANEL_ID);
            } catch (err) {
                console.error(`[TerminalService] scrollback trash write failed for ${id}:`, err);
                throw err;
            }
        }
    } catch (err) {
        console.error(`[TerminalService] scrollback trash step failed for ${id}:`, err);
        throw err;
    }
    try {
        await files.delete(scrollbackPath(id), PANEL_ID);
    } catch (err) {
        console.error(`[TerminalService] scrollback file delete failed for ${id}:`, err);
    }
}

// pure, exported for tests: every trashed scrollback is named after the
// live file, never in its place
export function trashScrollbackName(id: string, ts = Date.now()): string {
    return `.trash-${ts}-${id}.log`;
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
        run: async (ctx: Ctx, inputs: { label?: string }) => {
            const id = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const label = (inputs?.label || "").trim() || `Tab ${tabs.length + 1}`;
            tabs.push({ id, label });
            lastActiveId = id;
            activeTabId = id;
            await ensureSession(id);
            subscribeSession(id, ctx);
            await persistTabs(ctx);
            return id;
        },
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
            lastActiveId = id;
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
            const tab = tabs.find((t) => t.id === inputs?.id);
            if (!tab) throw new Error(`Unknown terminal tab "${inputs?.id}"`);
            const label = (inputs?.label || "").trim();
            if (!label) throw new Error("Label is required");
            tab.label = label;
            await persistTabs(ctx);
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
            const id = (inputs?.id || "").trim();
            tabs = tabs.filter((t) => t.id !== id);
            buffers.delete(id);
            // teardown: detach listeners and drop the subscription id, then
            // cancel the pending debounce so no write fires for a dead tab
            unsubscribeSession(id);
            cancelPersistTimer(id);
            // trash-first: recoverable before irrecoverable (see trashScrollback)
            await trashScrollback(id);
            try {
                await terminalApi.destroy(id);
            } catch (err) {
                console.error(`[TerminalService] session destroy failed for ${id}:`, err);
            }
            if (lastActiveId === id) lastActiveId = tabs[0]?.id || "";
            if (activeTabId === id) activeTabId = tabs[0]?.id || "";
            await persistTabs(ctx);
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
            const ids = Array.isArray(inputs?.orderedIds) ? inputs!.orderedIds.map((s) => String(s)) : [];
            const byId = new Map(tabs.map((t) => [t.id, t]));
            // accept only a permutation of the current tabs, no silent drops
            if (ids.length !== tabs.length || !ids.every((id) => byId.has(id))) {
                throw new Error("reorder-tabs requires exactly the current tab ids");
            }
            tabs = ids.map((id) => byId.get(id)!);
            await persistTabs(ctx);
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
            lastActiveId = id;
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
        run: async (_ctx: Ctx, inputs: { tabId?: string; lines?: number }) => {
            const id = resolveTabId(inputs?.tabId);
            const count = Math.max(1, Math.min(1000, Math.trunc(Number(inputs?.lines ?? 100))));
            return readWholeLines(buffers.get(id) || "", count);
        },
    }),

    defineAction({
        id: "run-terminal-command",
        name: "Run Shell Command",
        category: "Input",
        description: "Runs a one-shot shell command and returns its output",
        template: "Run shell command {command}",
        inputs: {
            command: { type: "string", label: "Command", placeholder: "Command", required: true },
        },
        output: { type: "string", label: "Output" },
        icon: "terminal",
        run: async (_ctx: Ctx, inputs: { command: string }) => {
            const cmd = (inputs?.command || "").trim();
            if (!cmd) throw new Error("Command is required");
            try {
                const shell = resolveOneShotShell();
                const res = await processApi.exec(shell.command, [...shell.baseArgs, cmd]);
                return res.stdout || res.stderr || "";
            } catch (err: any) {
                throw new Error(err?.message || String(err));
            }
        },
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
        tabCount: 0,
        activeTabId: "",
    },
    categories: [
        { name: "Sessions", icon: "terminal", order: 1 },
        { name: "Input", icon: "keyboard", order: 2 },
        { name: "Output", icon: "output", order: 3 },
        { name: "Events", icon: "bolt", order: 4 },
    ],
    actions: [...actions, ...eventActions],
    async onInit(ctx: Ctx) {
        try {
            const saved = await config.get<any>(PANEL_ID, "tabs.json");
            if (saved?.tabs && Array.isArray(saved.tabs)) {
                tabs = saved.tabs.filter(
                    (t: any) => t && typeof t.id === "string" && typeof t.label === "string",
                );
            }
            if (typeof saved?.activeTabId === "string") {
                activeTabId = saved.activeTabId;
                lastActiveId = saved.activeTabId;
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
            lastActiveId = "tab1";
            await ensureSession("tab1");
            subscribeSession("tab1", ctx);
            await persistTabs(ctx);
        } else {
            if (!tabs.some((t) => t.id === activeTabId)) {
                activeTabId = tabs[0].id;
                lastActiveId = tabs[0].id;
            }
            for (const tab of tabs) {
                await ensureSession(tab.id);
            }
        }

        updateCounts(ctx);
        console.log(`[TerminalService] Ready with ${tabs.length} persistent session(s).`);
    },
});

export default terminalService;
