// The agent's tool servers: tools.json, and one connection per enabled server.
//
// Servers start lazily (the first turn after they're configured or after a
// failure, see warm) and stop when removed, changed, or when the service
// stops: always awaited, never assumed. A failed server stays failed, with
// its reason, until it is restarted or the next turn retries it.

import path from "node:path";
import { PANEL_ID } from "../contract";
import {
    TOOL_LIMITS as L,
    type ServerSpec,
    type ServerStatus,
    type ToolsConfig,
    type ToolsView,
    DEFAULT_TOOLS,
} from "../toolsContract";
import type { ToolResult } from "./computerMcp";
import { checkSecretName, parseServer, parseToolsConfig, secretNames, vaultName } from "./mcpConfig";
import { HttpWire, McpClient, StdioWire, type McpTool, type ProcessHost } from "./mcpClient";

const WARM_MS = 25_000;
const RETRY_AFTER_MS = 30_000;

export interface Vault {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<boolean>;
    /** names only */
    list(): Promise<string[]>;
}

export interface ServersDeps {
    host: ProcessHost & { which(command: string): string | null };
    store: { read(): Promise<unknown>; write(c: ToolsConfig): Promise<void> };
    vault: Vault;
    fetch?: typeof fetch;
    /** the view changed; the service tells whoever is looking */
    onChange(view: ToolsView): void;
    now?(): number;
}

interface Entry {
    spec: ServerSpec;
    phase: ServerStatus["phase"];
    error: string | null;
    client: McpClient | null;
    tools: McpTool[];
    starting: Promise<void> | null;
    /** bumped to cancel whatever is starting */
    gen: number;
    failedAt: number;
}

export const processId = (name: string) => `${PANEL_ID}.mcp.${name}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class McpServers {
    config: ToolsConfig = structuredClone(DEFAULT_TOOLS);
    configError: string | null = null;
    private entries = new Map<string, Entry>();
    private lock: Promise<unknown> = Promise.resolve();
    private publishing = false;
    private dirty = false;
    private closed = false;

    constructor(private deps: ServersDeps) {}

    /** Read tools.json. A document that doesn't parse is reported and left alone: nothing writes over it. */
    async load(): Promise<void> {
        try {
            this.config = parseToolsConfig(await this.deps.store.read());
            this.configError = null;
        } catch (e) {
            this.config = structuredClone(DEFAULT_TOOLS);
            this.configError = message(e);
        }
        this.sync();
    }

    private sync() {
        // a removed server was stopped (and observed) before it left the config
        for (const name of [...this.entries.keys()]) {
            if (!this.config.servers.some((s) => s.name === name)) this.entries.delete(name);
        }
        for (const spec of this.config.servers) {
            const entry = this.entries.get(spec.name);
            if (entry) entry.spec = spec;
            else this.entries.set(spec.name, { spec, phase: "stopped", error: null, client: null, tools: [], starting: null, gen: 0, failedAt: 0 });
        }
    }

    private serial<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.lock.then(fn, fn);
        // the next change waits for this one to finish, however it ended; its caller gets the failure through `run`
        this.lock = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    // ------------------------------------------------------------- what's there

    status(): ServerStatus[] {
        return this.config.servers.map((s) => {
            const e = this.entries.get(s.name)!;
            return { name: s.name, phase: s.enabled ? e.phase : "stopped", error: s.enabled ? e.error : null, tools: e.phase === "running" ? e.tools.length : 0 };
        });
    }

    async view(): Promise<ToolsView> {
        const secrets: Record<string, string[]> = {};
        for (const full of await this.deps.vault.list()) {
            const m = /^mcp\.([a-z][a-z0-9-]*)\.(.+)$/.exec(full);
            if (m) (secrets[m[1]!] ??= []).push(m[2]!);
        }
        return { config: this.config, status: this.status(), secrets, configError: this.configError };
    }

    /** the servers that are up, with their tools */
    running(): { name: string; tools: McpTool[] }[] {
        return this.config.servers.flatMap((s) => {
            const e = this.entries.get(s.name);
            return s.enabled && e?.phase === "running" ? [{ name: s.name, tools: e.tools }] : [];
        });
    }

    /** servers that are on but not up, with why: the agent can tell the user */
    unavailable(): { name: string; reason: string }[] {
        return this.config.servers.flatMap((s) => {
            const e = this.entries.get(s.name);
            return s.enabled && e && e.phase !== "running" ? [{ name: s.name, reason: e.error ?? e.phase }] : [];
        });
    }

    // ------------------------------------------------------------- lifecycle

    /** Bring up every enabled server that isn't up, waiting a bounded time. Failures are recorded, not thrown. */
    async warm(): Promise<void> {
        if (this.closed) return;
        const now = (this.deps.now ?? Date.now)();
        const starts: Promise<void>[] = [];
        for (const e of this.entries.values()) {
            if (!e.spec.enabled || e.phase === "running") continue;
            if (e.phase === "failed" && now - e.failedAt < RETRY_AFTER_MS) continue;
            starts.push(this.start(e));
        }
        if (!starts.length) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([Promise.all(starts), new Promise<void>((ok) => (timer = setTimeout(ok, WARM_MS)))]);
        } finally {
            clearTimeout(timer);
        }
    }

    private start(e: Entry): Promise<void> {
        if (e.starting) return e.starting;
        const gen = ++e.gen;
        e.phase = "starting";
        e.error = null;
        this.changed();
        const run = (async () => {
            let client: McpClient | null = null;
            try {
                // TODO(remove after v0.3): with "computer" in ServerSpec.where
                if (e.spec.where === "computer") {
                    console.warn(`[ai] tool server ${e.spec.name} is set to run inside the agent's old VM computer, which is gone; it stays off until it's edited (this check goes away in v0.3)`);
                    this.settle(e, gen, "failed", "It ran inside the agent's old computer, which is a web browser now. Edit it to run on this computer.");
                    return;
                }
                client = new McpClient(await this.open(e.spec));
                const opened = client;
                opened.onEnd((reason) => {
                    if (e.client !== opened) return;
                    e.client = null;
                    e.tools = [];
                    this.settle(e, e.gen, "failed", reason);
                });
                await opened.initialize();
                const tools = await opened.listTools();
                if (e.gen !== gen) {
                    // removed or restarted while starting
                    await opened.close();
                    return;
                }
                e.client = opened;
                e.tools = tools;
                this.settle(e, gen, "running", null);
            } catch (err) {
                let why = message(err);
                if (client) {
                    try {
                        await client.close();
                    } catch (closeErr) {
                        why += ` (and it didn't stop: ${message(closeErr)})`;
                    }
                }
                if (e.gen === gen) this.settle(e, gen, "failed", why);
            }
        })().finally(() => {
            if (e.gen === gen) e.starting = null;
        });
        e.starting = run;
        return run;
    }

    private settle(e: Entry, gen: number, phase: Entry["phase"], error: string | null) {
        if (e.gen !== gen) return;
        e.phase = phase;
        e.error = error;
        if (phase === "failed") e.failedAt = (this.deps.now ?? Date.now)();
        if (phase !== "running") e.tools = e.client ? e.tools : [];
        this.changed();
    }

    /** Stop a server and observe that it stopped. */
    private async stop(e: Entry): Promise<void> {
        e.gen++;
        await e.starting;
        const client = e.client;
        e.client = null;
        e.tools = [];
        e.phase = "stopped";
        e.error = null;
        this.changed();
        if (client) await client.close();
    }

    private async open(spec: ServerSpec) {
        const values = async (v: Record<string, string | { secret: string }>) => {
            const out: Record<string, string> = {};
            for (const [k, x] of Object.entries(v)) {
                if (typeof x === "string") out[k] = x;
                else {
                    const got = await this.deps.vault.get(vaultName(spec.name, x.secret));
                    if (got === null) throw new Error(`the secret "${x.secret}" isn't saved; add it on the Tools page`);
                    out[k] = got;
                }
            }
            return out;
        };
        if (spec.transport === "http") return new HttpWire({ url: spec.url, headers: await values(spec.headers), fetch: this.deps.fetch });
        const env = await values(spec.env);
        const command = path.isAbsolute(spec.command) ? spec.command : this.deps.host.which(spec.command);
        if (!command) throw new Error(`"${spec.command}" isn't installed on this computer`);
        return StdioWire.start(this.deps.host, { id: processId(spec.name), command, args: spec.args, env });
    }

    private changed() {
        if (this.closed) return;
        this.dirty = true;
        if (this.publishing) return;
        this.publishing = true;
        void (async () => {
            try {
                while (this.dirty) {
                    this.dirty = false;
                    this.deps.onChange(await this.view());
                }
            } catch (e) {
                console.error("[ai] couldn't publish the tools view:", message(e));
            } finally {
                this.publishing = false;
            }
        })();
    }

    // ------------------------------------------------------------- the user's changes

    private writable() {
        if (this.configError) throw new Error(`tools.json can't be read (${this.configError}). Nothing was changed; fix or delete the file first.`);
    }

    private async commit(next: ToolsConfig) {
        const checked = parseToolsConfig(next);
        await this.deps.store.write(checked);
        this.config = checked;
        this.sync();
        this.changed();
    }

    /** Add a server, or replace the one with this name. The old one stops first. */
    save(raw: unknown): Promise<ToolsView> {
        return this.serial(async () => {
            this.writable();
            const spec = parseServer(raw);
            const existing = this.entries.get(spec.name);
            if (existing) await this.stop(existing);
            const servers = this.config.servers.some((s) => s.name === spec.name)
                ? this.config.servers.map((s) => (s.name === spec.name ? spec : s))
                : [...this.config.servers, spec];
            await this.commit({ ...this.config, servers });
            return this.view();
        });
    }

    /** Remove a server: it stops (observed), then its entry and its secrets go. */
    remove(name: unknown): Promise<ToolsView> {
        return this.serial(async () => {
            this.writable();
            const spec = this.config.servers.find((s) => s.name === name);
            if (!spec) throw new Error("there's no such server");
            await this.stop(this.entries.get(spec.name)!);
            await this.commit({ ...this.config, servers: this.config.servers.filter((s) => s !== spec) });
            const failed: string[] = [];
            for (const secret of secretNames(spec)) {
                try {
                    await this.deps.vault.delete(vaultName(spec.name, secret));
                } catch (e) {
                    failed.push(`${secret} (${message(e)})`);
                }
            }
            if (failed.length) throw new Error(`${spec.name} was removed, but its secrets couldn't be deleted: ${failed.join(", ")}`);
            return this.view();
        });
    }

    /** Stop a server and start it again now. */
    restart(name: unknown): Promise<ToolsView> {
        return this.serial(async () => {
            const e = this.entries.get(String(name));
            if (!e) throw new Error("there's no such server");
            if (!e.spec.enabled) throw new Error("it's switched off");
            await this.stop(e);
            await this.start(e);
            return this.view();
        });
    }

    setActions(on: unknown): Promise<ToolsView> {
        return this.serial(async () => {
            this.writable();
            if (typeof on !== "boolean") throw new Error("on or off");
            await this.commit({ ...this.config, actions: on });
            return this.view();
        });
    }

    /** Put a secret's value in the vault. The config only ever holds its name. */
    setSecret(server: unknown, name: unknown, value: unknown): Promise<ToolsView> {
        return this.serial(async () => {
            const e = this.entries.get(String(server));
            if (!e) throw new Error("add the server first");
            const secret = checkSecretName(name);
            if (typeof value !== "string" || !value) throw new Error("the secret is empty");
            if (value.length > L.secretValue) throw new Error(`secrets are limited to ${L.secretValue} characters`);
            await this.deps.vault.set(vaultName(e.spec.name, secret), value);
            // a running server has the old value: it starts again with the new one when next needed
            if (secretNames(e.spec).includes(secret)) await this.stop(e);
            this.changed();
            return this.view();
        });
    }

    deleteSecret(server: unknown, name: unknown): Promise<ToolsView> {
        return this.serial(async () => {
            const e = this.entries.get(String(server));
            if (!e) throw new Error("there's no such server");
            const secret = checkSecretName(name);
            if (secretNames(e.spec).includes(secret)) throw new Error(`${e.spec.name} still uses "${secret}"; change the server first`);
            await this.deps.vault.delete(vaultName(e.spec.name, secret));
            this.changed();
            return this.view();
        });
    }

    // ------------------------------------------------------------- the agent's use

    async callTool(server: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
        const e = this.entries.get(server);
        if (!e || !e.spec.enabled) return { isError: true, text: `There's no tool server called ${server}.` };
        if (e.phase !== "running" || !e.client) {
            return { isError: true, text: `${server} isn't running${e.error ? `: ${e.error}` : ""}. Tell the user; they can restart it on the Tools page.` };
        }
        if (!e.tools.some((t) => t.name === tool)) return { isError: true, text: `${server} has no tool ${tool}.` };
        try {
            return await e.client.callTool(tool, args);
        } catch (err) {
            return { isError: true, text: `${server}: ${message(err)}` };
        }
    }

    /** Stop every server and observe each one gone. */
    async shutdown(): Promise<void> {
        this.closed = true;
        const results = await Promise.allSettled([...this.entries.values()].map((e) => this.stop(e)));
        const failures = results.flatMap((r) => (r.status === "rejected" ? [message(r.reason)] : []));
        if (failures.length) throw new Error(`tool servers didn't all stop: ${failures.join("; ")}`);
    }
}
