import {
    definePanelService,
    defineAction,
    defineTrigger,
    config,
    terminalApi,
    processApi,
    files,
    type ServiceContext,
} from "@paperboard-dev/paperapi";

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

const SCROLLBACK_CHARS = 200000;
const SCROLLBACK_DIR = "terminal-scrollback";

let tabs: TerminalTab[] = [];
let activeTabId = "";
let lastActiveId = "";

const buffers = new Map<string, string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscribedSessions = new Set<string>();

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
            files.write(scrollbackPath(id), buffers.get(id) || "", PANEL_ID).catch(() => {});
        }, 500),
    );
}

function updateCounts(ctx: Ctx) {
    ctx.setState({ tabCount: tabs.length, activeTabId });
}

async function persistTabs(ctx: Ctx | null) {
    try {
        await config.set({ tabs, activeTabId }, PANEL_ID);
    } catch {}
    if (ctx) updateCounts(ctx);
}

function subscribeSession(id: string, ctx: Ctx | null) {
    if (subscribedSessions.has(id)) return;
    subscribedSessions.add(id);
    try {
        terminalApi.onData(id, (data) => {
            if (!tabs.some((t) => t.id === id)) return;
            buffers.set(id, ((buffers.get(id) || "") + data).slice(-SCROLLBACK_CHARS));
            schedulePersist(id);
        });
        terminalApi.onExit(id, (exitCode) => {
            buffers.delete(id);
            ctx?.emitTrigger("terminal-exit", { tabId: id, exitCode });
        });
    } catch {}
}

async function ensureSession(id: string, cols?: number, rows?: number) {
    let exists = false;
    try {
        exists = await terminalApi.exists(id);
    } catch {
        exists = false;
    }
    if (!exists) {
        try {
            await terminalApi.create(id, { cols, rows });
        } catch {}
    }
}

function resolveTabId(input?: string): string {
    const clean = (input || "").trim();
    if (clean && tabs.some((t) => t.id === clean)) return clean;
    if (lastActiveId && tabs.some((t) => t.id === lastActiveId)) return lastActiveId;
    return tabs[0]?.id || "";
}

const actions = [
    defineAction({
        id: "list-tabs",
        name: "List Terminal Tabs",
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
            try {
                await files.delete(scrollbackPath(id), PANEL_ID);
            } catch {}
            try {
                await terminalApi.destroy(id);
            } catch {}
            if (lastActiveId === id) lastActiveId = tabs[0]?.id || "";
            if (activeTabId === id) activeTabId = tabs[0]?.id || "";
            await persistTabs(ctx);
            return true;
        },
    }),

    defineAction({
        id: "touch-tab",
        name: "Touch Terminal Tab",
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
        description: "Sends keystrokes to a live terminal session",
        template: "Write {text} to terminal {tabId}",
        inputs: {
            tabId: { type: "string", label: "Tab", placeholder: "Tab" },
            text: { type: "string", label: "Text", placeholder: "Text", required: true },
        },
        output: { type: "boolean", label: "Success" },
        icon: "keyboard",
        run: async (_ctx: Ctx, inputs: { tabId?: string; text: string }) => {
            const id = resolveTabId(inputs?.tabId);
            if (!id) throw new Error("No terminal sessions exist");
            await ensureSession(id);
            terminalApi.write(id, inputs?.text || "");
            return true;
        },
    }),

    defineAction({
        id: "read-terminal-buffer",
        name: "Read Terminal Output",
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
            if (!id) return "";
            const count = Math.max(1, Math.min(1000, Math.trunc(Number(inputs?.lines ?? 100))));
            return (buffers.get(id) || "").split("\n").slice(-count).join("\n");
        },
    }),

    defineAction({
        id: "run-terminal-command",
        name: "Run Shell Command",
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
                const res = await processApi.exec("sh", ["-c", cmd]);
                return res.stdout || res.stderr || "";
            } catch (err: any) {
                throw new Error(err?.message || String(err));
            }
        },
    }),
];

const triggers = [
    defineTrigger({
        id: "terminal-exit",
        name: "When Terminal Session Ends",
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
    actions,
    triggers,
    async onInit(ctx: Ctx) {
        try {
            const saved = await config.get<any>(PANEL_ID);
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
            } catch {}
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
