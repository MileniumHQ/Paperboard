// The agent's hands on its own tool servers: it lists them, and adds, changes
// or removes one when the user asks for it. It finds a server's address or
// command itself.
//
// What it can't do alone: a server that runs a program on the user's computer
// (stdio) waits for the user to allow it on a card, and so does a change to
// what such a program runs; nothing starts before. A key goes in as a
// `{ secret }` name and is asked for with ask_user, so the vault holds it and
// the agent never sees it. A server that signs the user in (OAuth) gets a card
// in the chat to sign in from; their sign-in starts the agent's next turn.

import crypto from "node:crypto";
import { LIMITS, type ToolServerEntry, type ToolSignInEntry } from "../contract";
import { OAUTH_SECRET, type ServerSpec, type ServerStatus, type ServerValue, type ToolsView } from "../toolsContract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { parseServer, secretNames } from "./mcpConfig";
import type { McpServers } from "./mcpServers";
import type { Launch } from "./which";
import type { Toolset } from "./toolsets";

const L = LIMITS.toolServers;
/** how long a tool waits for a server it just added to come up, before it says it's still starting */
const START_MS = 20_000;
/** tool names told back per server */
const NAMES_TOLD = 20;

export const SERVER_INSTRUCTIONS = `**Tool servers (MCP):** when the user asks you to connect a service, find its official MCP server in the service's own docs and \`add_tool_server\`, saying which server, whose it is and what it lets you do. Prefer a hosted \`url\`; a \`command\` runs on their computer. Add only what they asked for, and change or remove one only when they ask.`;

const VALUES = {
    type: "object",
    description: 'Names and values. A key or token is `{ "secret": "<name>" }`, never the key itself: then ask for it with `ask_user`, a secret field for this server and name.',
    additionalProperties: { oneOf: [{ type: "string" }, { type: "object", properties: { secret: { type: "string" } }, required: ["secret"] }] },
};

const SERVER_FIELDS = {
    name: { type: "string", description: "Its name: lowercase letters, digits and dashes, like `linear`." },
    url: { type: "string", description: "A server on the web: its MCP address." },
    oauth: { type: "boolean", description: "With url: it signs the user in (OAuth). They sign in on a card in the chat; their sign-in starts your next turn." },
    sse: { type: "boolean", description: "With url: it uses the older HTTP+SSE transport." },
    headers: { ...VALUES, description: `With url: headers to send. ${VALUES.description}` },
    command: { type: "string", description: "A program on the user's computer: the program alone, like `npx`." },
    args: { type: "array", items: { type: "string" }, description: "With command: its arguments, one per item, like `[\"-y\", \"@scope/server\"]`. Never a shell line." },
    env: { ...VALUES, description: `With command: its environment. ${VALUES.description}` },
    reason: { type: "string", description: `With command: what it is and why you're adding it, for the card the user allows it on. Up to ${L.reasonChars} characters.` },
};

export const SERVER_TOOLS: ToolSpec[] = [
    {
        name: "list_tool_servers",
        description: "List your tool servers: how each is reached, the secrets it names (and whether they're saved), and how it's doing.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "add_tool_server",
        description:
            "Add a tool server the user asked for: a `url` (on the web) or a `command` (a program on their computer, which they allow on a card first). " +
            "Its tools are yours from your next turn.",
        inputSchema: { type: "object", properties: SERVER_FIELDS, required: ["name"] },
    },
    {
        name: "update_tool_server",
        description:
            "Change one of your tool servers: give its name and only what changes (a `url` or `command` switches how it's reached). " +
            "`enabled: false` switches it off. A change to what a program runs is allowed by the user on a card first.",
        inputSchema: {
            type: "object",
            properties: { ...SERVER_FIELDS, enabled: { type: "boolean", description: "Switch it on or off." } },
            required: ["name"],
        },
    },
    {
        name: "remove_tool_server",
        description: "Remove one of your tool servers, when the user asks. It stops, and the secrets saved for it are deleted.",
        inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
        name: "ask_tool_server_sign_in",
        description: "Put a card in the chat for the user to sign in to one of your web tool servers that needs it. Their sign-in starts your next turn.",
        inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
];

export interface ServerToolsDeps {
    servers: McpServers;
    findProgram(command: string, args: readonly string[]): Launch | null;
    /** add or update a card in the conversation */
    post(entry: ToolServerEntry | ToolSignInEntry): void;
    /** tell the agent how it went (starts a turn) */
    notice(text: string): void;
    waitMs?: number;
    startMs?: number;
}

const fault = (text: string): ToolResult => ({ isError: true, text });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const WEB_KEYS = ["url", "oauth", "sse", "headers"];
const PROGRAM_KEYS = ["command", "args", "env"];
const COMMON_KEYS = ["name", "reason"];

/** what a program runs, to tell whether a change is one the user allows first */
const runs = (s: ServerSpec) => (s.transport === "stdio" ? JSON.stringify([s.command, s.args, s.env]) : null);

export class ServerTools {
    private pending: { entry: ToolServerEntry; spec: ServerSpec; timer: ReturnType<typeof setTimeout> } | null = null;
    /** servers with a sign-in card out, told about when they come up */
    private awaiting = new Set<string>();

    constructor(private deps: ServerToolsDeps) {}

    toolset(): Toolset {
        return {
            id: "tool-servers",
            // a flow has no one to allow a program or sign in: it can only look
            tools: (mode) => (mode.fromFlow ? SERVER_TOOLS.filter((t) => t.name === "list_tool_servers") : SERVER_TOOLS),
            instructions: (mode) => (mode.fromFlow ? "" : SERVER_INSTRUCTIONS),
            call: async (name, args) => {
                try {
                    switch (name) {
                        case "list_tool_servers":
                            return await this.list();
                        case "add_tool_server":
                            return await this.add(args);
                        case "update_tool_server":
                            return await this.update(args);
                        case "remove_tool_server":
                            return await this.remove(args);
                        case "ask_tool_server_sign_in":
                            return await this.askSignIn(args);
                    }
                    return fault(`unknown tool ${name}`);
                } catch (e) {
                    console.warn(`[ai] ${name} failed:`, message(e));
                    return fault(message(e));
                }
            },
        };
    }

    private get servers() {
        return this.deps.servers;
    }

    private find(name: unknown): ServerSpec {
        const spec = this.servers.config.servers.find((s) => s.name === name);
        if (!spec) throw new Error(`you have no tool server called "${String(name)}"; list_tool_servers shows the ones you have`);
        return spec;
    }

    private async list(): Promise<ToolResult> {
        const view = await this.servers.view();
        if (!view.config.servers.length) return { text: "You have no tool servers yet." };
        const out = view.config.servers.map((s) => {
            const saved = view.secrets[s.name] ?? [];
            const values = (v: Record<string, ServerValue>) =>
                Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x : { secret: x.secret, saved: saved.includes(x.secret) }]));
            const status = view.status.find((x) => x.name === s.name)!;
            return {
                name: s.name,
                ...(s.transport === "http"
                    ? { url: s.url, headers: values(s.headers), oauth: s.oauth, ...(s.oauth ? { signedIn: saved.includes(OAUTH_SECRET) } : {}), ...(s.sse ? { sse: true } : {}) }
                    : { command: s.command, args: s.args, env: values(s.env) }),
                enabled: s.enabled,
                status: s.enabled ? statusText(status) : "switched off",
            };
        });
        return { text: JSON.stringify({ servers: out, ...(view.configError ? { error: `tools.json can't be read: ${view.configError}` } : {}) }, null, 1) };
    }

    private async add(args: Record<string, unknown>): Promise<ToolResult> {
        if (this.servers.config.servers.some((s) => s.name === args.name)) {
            return fault(`you already have a tool server called "${String(args.name)}"; change it with update_tool_server, or pick another name`);
        }
        const spec = specFrom(args, null);
        if (spec.transport === "stdio") return this.ask(spec, false, args.reason);
        await this.servers.save(spec);
        return { text: `Added ${spec.name}. ${await this.bringUp(spec.name)}` };
    }

    private async update(args: Record<string, unknown>): Promise<ToolResult> {
        const current = this.find(args.name);
        const spec = specFrom(args, current);
        if (spec.transport === "stdio" && runs(spec) !== runs(current)) return this.ask(spec, true, args.reason);
        await this.servers.save(spec);
        if (!spec.enabled) return { text: `Changed ${spec.name}. It's switched off.` };
        return { text: `Changed ${spec.name}. ${await this.bringUp(spec.name)}` };
    }

    private async remove(args: Record<string, unknown>): Promise<ToolResult> {
        const spec = this.find(args.name);
        this.awaiting.delete(spec.name);
        await this.servers.remove(spec.name);
        return { text: `Removed ${spec.name}. It's stopped, and the secrets saved for it are deleted.` };
    }

    private async askSignIn(args: Record<string, unknown>): Promise<ToolResult> {
        const spec = this.find(args.name);
        if (spec.transport !== "http") return fault(`${spec.name} is a program on the user's computer; there's nothing to sign in to`);
        if (!spec.enabled) return fault(`${spec.name} is switched off; switch it on first`);
        const status = this.servers.status().find((s) => s.name === spec.name);
        const signedIn = ((await this.servers.view()).secrets[spec.name] ?? []).includes(OAUTH_SECRET);
        if (!status?.needsSignIn && !(spec.oauth && !signedIn)) return fault(`${spec.name} doesn't need the user to sign in; it's ${status ? statusText(status) : "not started"}`);
        this.postSignIn(spec);
        return { text: `Asked the user to sign in to ${spec.name} on a card in the chat. Their sign-in starts your next turn. Don't wait for it: finish this turn.` };
    }

    // ------------------------------------------------------------- bringing one up

    /**
     * Start a server now, so the agent hears how it went. One that needs a key waits for it, and one that
     * needs the user to sign in gets its card.
     */
    private async bringUp(name: string): Promise<string> {
        const spec = this.find(name);
        if (!spec.enabled) return "It's switched off.";
        const saved = (await this.servers.view()).secrets[name] ?? [];
        const missing = secretNames(spec).filter((s) => s !== OAUTH_SECRET && !saved.includes(s));
        if (missing.length) {
            return `It needs ${missing.map((m) => `"${m}"`).join(" and ")} before it can start: ask the user with ask_user, a secret field for server ${name} and that name.`;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let done = false;
        try {
            await Promise.race([
                this.servers.restart(name).then(() => void (done = true)),
                new Promise<void>((ok) => (timer = setTimeout(ok, this.deps.startMs ?? START_MS))),
            ]);
        } finally {
            clearTimeout(timer);
        }
        const status = this.servers.status().find((s) => s.name === name);
        if (!status) return "It was removed meanwhile.";
        if (status.needsSignIn) {
            this.postSignIn(spec);
            return "The user has to sign in to it: they do on a card in the chat, and their sign-in starts your next turn. Tell them, and finish this turn.";
        }
        if (!done || status.phase === "starting") return "It's still starting; list_tool_servers shows how it's doing.";
        if (status.phase === "running") return `It's running with ${toolsText(this.servers, name)} They're yours from your next turn.`;
        return `It didn't start: ${status.error ?? "it stopped"}. Tell the user, then fix it with update_tool_server or remove it.`;
    }

    private postSignIn(spec: ServerSpec) {
        if (spec.transport !== "http") return;
        this.awaiting.add(spec.name);
        this.deps.post({ id: crypto.randomBytes(8).toString("hex"), at: Date.now(), kind: "tool-sign-in", server: spec.name, url: spec.url });
    }

    /** The tools changed: a server the user was asked to sign in to that's up now is told to the agent. */
    seen(view: ToolsView) {
        for (const name of [...this.awaiting]) {
            const s = view.status.find((x) => x.name === name);
            if (!s) {
                this.awaiting.delete(name);
                continue;
            }
            if (s.phase === "running") {
                this.awaiting.delete(name);
                this.tell(`The user signed in to ${name}. It's running with ${toolsText(this.servers, name)} They're in your tools now: go on with what they asked.`);
            } else if (s.phase === "failed" && !s.needsSignIn) {
                // it was started again (after a sign-in) and failed for another reason
                this.awaiting.delete(name);
                this.tell(`${name}, which you asked the user to sign in to, didn't start: ${s.error ?? "it stopped"}. Tell the user.`);
            }
        }
    }

    // ------------------------------------------------------------- a program, allowed first

    private ask(spec: ServerSpec, change: boolean, rawReason: unknown): ToolResult {
        if (spec.transport !== "stdio") throw new Error("only a program is allowed first");
        const reason = typeof rawReason === "string" ? rawReason.trim() : "";
        if (!reason || reason.length > L.reasonChars) return fault(`give a reason of up to ${L.reasonChars} characters: what the program is, whose it is, and why you're adding it`);
        if (!this.deps.findProgram(spec.command, spec.args)) return fault(`"${spec.command}" isn't installed on the user's computer; tell them what to install, or find a server on the web instead`);
        this.lapse(); // the one before, unanswered, is replaced
        const entry: ToolServerEntry = {
            id: crypto.randomBytes(8).toString("hex"),
            at: Date.now(),
            kind: "tool-server",
            server: spec.name,
            change,
            reason,
            command: [spec.command, ...spec.args],
            env: Object.entries(spec.env).map(([name, v]) => ({ name, value: typeof v === "string" ? v : null })),
            status: "waiting",
        };
        const timer = setTimeout(() => {
            if (this.pending?.entry.id !== entry.id) return;
            this.lapse();
            this.tell(`The user didn't answer whether ${spec.name} may run on their computer in time; it has lapsed.`);
        }, this.deps.waitMs ?? L.waitMinutes * 60_000);
        this.pending = { entry, spec, timer };
        this.deps.post(entry);
        return { text: "Asked the user to allow it on a card in the chat; nothing runs until they do. Their answer starts your next turn. Don't wait for it: finish this turn." };
    }

    /** The user's answer to a program the agent asked to run. Allowed, it's saved; it starts, and the agent is told how it went. */
    async answer(id: unknown, allow: unknown): Promise<{ status: ToolServerEntry["status"] }> {
        const p = this.pending;
        if (!p || p.entry.id !== id || p.entry.status !== "waiting") throw new Error("That request isn't waiting anymore.");
        if (typeof allow !== "boolean") throw new Error("allow it or not");
        clearTimeout(p.timer);
        const name = p.spec.name;
        if (!allow) {
            this.finish({ status: "declined" });
            this.tell(`The user said no to running ${name} on their computer. Don't add it again unless they bring it up.`);
            return { status: "declined" };
        }
        try {
            const exists = this.servers.config.servers.some((s) => s.name === name);
            if (p.entry.change && !exists) throw new Error(`${name} was removed meanwhile`);
            if (!p.entry.change && exists) throw new Error(`a server called ${name} was added meanwhile`);
            await this.servers.save(p.spec);
        } catch (e) {
            const error = message(e);
            this.finish({ status: "failed", error });
            this.tell(`The user allowed ${name}, but it couldn't be saved: ${error}.`);
            throw new Error(`Not saved: ${error}`);
        }
        this.finish({ status: "allowed" });
        // the click is answered now; starting can take a while (a package to download), and the agent hears how it went
        void this.bringUp(name).then(
            (how) => this.tell(`The user allowed ${name} to run on their computer, and it's ${p.entry.change ? "changed" : "added"}. ${how}`),
            (e) => this.tell(`The user allowed ${name}, and it's saved, but it couldn't be started: ${message(e)}.`),
        );
        return { status: "allowed" };
    }

    /** The conversation is put away or the service stops: a waiting request lapses, and its card says so. */
    shutdown() {
        this.lapse();
        this.awaiting.clear();
    }

    private lapse() {
        const p = this.pending;
        if (!p || p.entry.status !== "waiting") return;
        clearTimeout(p.timer);
        this.finish({ status: "expired" });
    }

    private finish(patch: Partial<ToolServerEntry>) {
        const p = this.pending;
        if (!p) return;
        p.entry = { ...p.entry, ...patch };
        this.deps.post(p.entry);
        this.pending = null;
    }

    private tell(text: string) {
        try {
            this.deps.notice(text);
        } catch (e) {
            // the card already shows the answer; the agent hears of it when it's next asked
            console.error("[ai] couldn't tell the agent about its tool servers:", message(e));
        }
    }
}

/** A server from the agent's arguments, over the one it changes. The config's own checks run on it. */
function specFrom(args: Record<string, unknown>, base: ServerSpec | null): ServerSpec {
    const web = args.url !== undefined;
    const program = args.command !== undefined;
    if (web && program) throw new Error("give a url (a server on the web) or a command (a program on the user's computer), not both");
    const transport = web ? "http" : program ? "stdio" : base?.transport;
    if (!transport) throw new Error("give the server's url, or the command that runs it");
    const allowed = [...COMMON_KEYS, ...(transport === "http" ? WEB_KEYS : PROGRAM_KEYS), ...(base ? ["enabled"] : [])];
    for (const k of Object.keys(args)) {
        if (!allowed.includes(k)) {
            throw new Error(
                [...WEB_KEYS, ...PROGRAM_KEYS].includes(k)
                    ? `"${k}" is for ${transport === "http" ? "a program (with command)" : "a server on the web (with url)"}`
                    : `"${k}" isn't a setting`,
            );
        }
    }
    // the same kind of server keeps what isn't changed; switching kinds starts from what's given
    const kept: Record<string, unknown> = base && base.transport === transport ? { ...base } : {};
    const pick = (k: string, fallback: unknown) => (args[k] !== undefined ? args[k] : (kept[k] ?? fallback));
    const common = { name: args.name, where: "host", transport, enabled: pick("enabled", base?.enabled ?? true) };
    if (transport === "http") return parseServer({ ...common, url: pick("url", undefined), headers: pick("headers", {}), oauth: pick("oauth", false), sse: pick("sse", false) });
    return parseServer({ ...common, command: pick("command", undefined), args: pick("args", []), env: pick("env", {}) });
}

function statusText(s: ServerStatus): string {
    if (s.needsSignIn) return "needs the user to sign in (ask_tool_server_sign_in puts a card in the chat)";
    if (s.phase === "running") return `running, ${s.tools} tools`;
    if (s.phase === "failed") return `failed: ${s.error ?? "it stopped"}`;
    return s.phase === "starting" ? "starting" : "not started yet (it starts at your next turn)";
}

function toolsText(servers: McpServers, name: string): string {
    const tools = servers.running().find((s) => s.name === name)?.tools ?? [];
    if (!tools.length) return "no tools.";
    const names = tools.slice(0, NAMES_TOLD).map((t) => t.name);
    return `${tools.length === 1 ? "1 tool" : `${tools.length} tools`}: ${names.join(", ")}${tools.length > NAMES_TOLD ? ", …" : ""}.`;
}
