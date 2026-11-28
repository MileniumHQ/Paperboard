// The agent's tool servers: tools.json, and one connection per enabled server.
//
// Servers start lazily (the first turn after they're configured or after a
// failure, see warm) and stop when removed, changed, or when the service
// stops: always awaited, never assumed. A failed server stays failed, with
// its reason, until it is restarted or the next turn retries it.

import { errorMessage, problemsApi, SerialQueue } from "@mileniumhq/paperapi";
import type { Launch } from "./which";
import { PANEL_ID } from "../contract";
import crypto from "node:crypto";
import {
    TOOL_LIMITS as L,
    OAUTH_SECRET,
    type ServerSpec,
    type ServerStatus,
    type SignIn,
    type ToolsConfig,
    type ToolsView,
    DEFAULT_TOOLS,
} from "../toolsContract";
import type { ToolResult } from "./computerMcp";
import { checkSecretName, parseServer, parseToolsConfig, secretNames, vaultName } from "./mcpConfig";
import { McpClient, type McpTool } from "./mcpClient";
import { HttpWire, SseWire, Unauthorized } from "./mcpHttp";
import { StdioWire, type ProcessHost } from "./mcpStdio";
import { Callback, SIGN_IN_MS, SignInNeeded, TokenRefused, authorizeUrl, discover, exchange, parseTokens, pkcePair, refresh, register, stale, type Tokens } from "./mcpOAuth";

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
    host: ProcessHost & { findProgram(command: string, args: readonly string[]): Launch | null };
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
    /** it failed because the user has to sign in (again) */
    needsSignIn: boolean;
}

/** a sign-in waiting for the browser to come back */
interface Pending extends SignIn {
    state: string;
    verifier: string;
    client: Pick<Tokens, "clientId" | "clientSecret" | "clientAuth" | "tokenEndpoint" | "resource">;
    listener: Callback;
    timer: ReturnType<typeof setTimeout>;
    /** set once the code is being traded, so a second arrival is ignored */
    finishing: boolean;
}

const processId = (name: string) => `${PANEL_ID}.mcp.${name}`;

export class McpServers {
    config: ToolsConfig = structuredClone(DEFAULT_TOOLS);
    configError: string | null = null;
    private entries = new Map<string, Entry>();
    private signIns = new Map<string, Pending>();
    private lock = new SerialQueue();
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
            this.configError = errorMessage(e);
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
            else this.entries.set(spec.name, { spec, phase: "stopped", error: null, client: null, tools: [], starting: null, gen: 0, failedAt: 0, needsSignIn: false });
        }
    }

    // ------------------------------------------------------------- what's there

    status(): ServerStatus[] {
        return this.config.servers.map((s) => {
            const e = this.entries.get(s.name)!;
            return {
                name: s.name,
                phase: s.enabled ? e.phase : "stopped",
                needsSignIn: s.enabled && e.needsSignIn,
                error: s.enabled ? e.error : null,
                tools: e.phase === "running" ? e.tools.length : 0,
            };
        });
    }

    /**
     * tools.json read again after it couldn't be (the person fixed or deleted it): the view, with why when it
     * still can't be read. A file that was read is the service's to change, so it isn't read over what's running.
     */
    async reload(): Promise<ToolsView> {
        if (this.configError) {
            // while it couldn't be read, nothing in it was set up: there is no server to stop
            await this.load();
            this.changed();
        }
        return this.view();
    }

    async view(): Promise<ToolsView> {
        const secrets: Record<string, string[]> = {};
        for (const full of await this.deps.vault.list()) {
            const m = /^mcp\.([a-z][a-z0-9-]*)\.(.+)$/.exec(full);
            if (m) (secrets[m[1]!] ??= []).push(m[2]!);
        }
        const signIns: Record<string, SignIn> = {};
        for (const [name, p] of this.signIns) signIns[name] = { url: p.url, callback: p.callback, error: p.error };
        return { config: this.config, status: this.status(), secrets, configError: this.configError, signIns };
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
            if (!e.spec.enabled || e.phase === "running" || e.needsSignIn) continue;
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
        e.needsSignIn = false;
        this.changed();
        const run = (async () => {
            let client: McpClient | null = null;
            try {
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
                let why = errorMessage(err);
                if (err instanceof Unauthorized || err instanceof SignInNeeded) {
                    e.needsSignIn = true;
                    why = err instanceof Unauthorized && !(e.spec.transport === "http" && e.spec.oauth) ? "it asks you to sign in" : why;
                }
                if (client) {
                    try {
                        await client.close();
                    } catch (closeErr) {
                        why += ` (and it didn't stop: ${errorMessage(closeErr)})`;
                    }
                }
                if (e.gen === gen) this.settle(e, gen, "failed", why);
            }
        })().finally(() => {
            // a stop meanwhile moved gen on and waits on this run; it's over either way
            if (e.starting === run) e.starting = null;
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
        e.needsSignIn = false;
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
        if (spec.transport === "http") {
            const authorize = spec.oauth ? (fresh: boolean) => this.authorization(spec.name, fresh) : undefined;
            const o = { url: spec.url, headers: await values(spec.headers), fetch: this.deps.fetch, authorize };
            return spec.sse ? SseWire.open(o) : new HttpWire(o);
        }
        const env = await values(spec.env);
        const launch = this.deps.host.findProgram(spec.command, spec.args);
        if (!launch) throw new Error(`"${spec.command}" isn't installed on this computer`);
        return StdioWire.start(this.deps.host, { id: processId(spec.name), command: launch.command, args: launch.args, env });
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
                // the tools view keeps its last copy; nobody is waiting on this publish
                const title = "The tools Agents can use couldn't be shown";
                problemsApi.report(PANEL_ID, { key: title, title, message: errorMessage(e) });
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
        return this.lock.run(async () => {
            this.writable();
            await this.put(parseServer(raw));
            return this.view();
        });
    }

    /** Switch a server on or off, as it is otherwise. One that's switched on starts when the agent next needs its tools. */
    setEnabled(name: unknown, on: unknown): Promise<ToolsView> {
        return this.lock.run(async () => {
            this.writable();
            if (typeof on !== "boolean") throw new Error("on or off");
            const spec = this.config.servers.find((s) => s.name === name);
            if (!spec) throw new Error("there's no such server");
            if (spec.enabled !== on) await this.put({ ...spec, enabled: on });
            return this.view();
        });
    }

    /** Save a server's spec. The secrets the old spec named and this one doesn't are deleted. */
    private async put(spec: ServerSpec) {
        const existing = this.entries.get(spec.name);
        if (existing) await this.stop(existing);
        const old = this.config.servers.find((s) => s.name === spec.name);
        const servers = old ? this.config.servers.map((s) => (s === old ? spec : s)) : [...this.config.servers, spec];
        await this.commit({ ...this.config, servers });
        const kept = secretNames(spec);
        await this.deleteSecrets(spec.name, old ? secretNames(old).filter((s) => !kept.includes(s)) : [], "was saved");
    }

    /** Remove a server: it stops (observed), then its entry and every secret saved for it go. */
    remove(name: unknown): Promise<ToolsView> {
        return this.lock.run(async () => {
            this.writable();
            const spec = this.config.servers.find((s) => s.name === name);
            if (!spec) throw new Error("there's no such server");
            this.cancelSignIn(spec.name);
            await this.stop(this.entries.get(spec.name)!);
            await this.commit({ ...this.config, servers: this.config.servers.filter((s) => s !== spec) });
            // by the server's own prefix, so a secret its spec stopped naming goes too
            const prefix = vaultName(spec.name, "");
            const saved = (await this.deps.vault.list()).filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length));
            await this.deleteSecrets(spec.name, saved, "was removed");
            return this.view();
        });
    }

    private async deleteSecrets(server: string, secrets: string[], done: string) {
        const failed: string[] = [];
        for (const secret of secrets) {
            try {
                await this.deps.vault.delete(vaultName(server, secret));
            } catch (e) {
                failed.push(`${secret} (${errorMessage(e)})`);
            }
        }
        if (failed.length) throw new Error(`${server} ${done}, but its secrets couldn't be deleted: ${failed.join(", ")}`);
    }

    /** Stop a server and start it again now. */
    restart(name: unknown): Promise<ToolsView> {
        return this.lock.run(async () => {
            const e = this.entries.get(String(name));
            if (!e) throw new Error("there's no such server");
            if (!e.spec.enabled) throw new Error("it's switched off");
            await this.stop(e);
            await this.start(e);
            return this.view();
        });
    }

    setBlocks(on: unknown): Promise<ToolsView> {
        return this.lock.run(async () => {
            this.writable();
            if (typeof on !== "boolean") throw new Error("on or off");
            await this.commit({ ...this.config, blocks: on });
            return this.view();
        });
    }

    /** Put a secret's value in the vault. The config only ever holds its name. */
    setSecret(server: unknown, name: unknown, value: unknown): Promise<ToolsView> {
        return this.lock.run(async () => {
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

    // ------------------------------------------------------------- signing in

    private get fetcher() {
        return this.deps.fetch ?? fetch;
    }

    /** The Authorization header for a signed-in server, refreshing its tokens when they're due (or `fresh` is asked for). */
    private async authorization(server: string, fresh: boolean): Promise<string> {
        const saved = await this.deps.vault.get(vaultName(server, OAUTH_SECRET));
        if (saved === null) throw new SignInNeeded("sign in to it first");
        let t = parseTokens(saved);
        if (fresh || stale(t, (this.deps.now ?? Date.now)())) {
            try {
                t = await refresh(this.fetcher, t);
            } catch (e) {
                if (e instanceof SignInNeeded) throw e;
                // refused, it takes a new sign-in; a server that couldn't be asked is tried again, as any failure to start is
                if (e instanceof TokenRefused) throw new SignInNeeded(`the sign-in couldn't be renewed (${e.message}); sign in again`);
                throw new Error(`the sign-in couldn't be renewed: ${errorMessage(e)}`);
            }
            await this.deps.vault.set(vaultName(server, OAUTH_SECRET), JSON.stringify(t));
        }
        return `${/^bearer$/i.test(t.type) ? "Bearer" : t.type} ${t.access}`;
    }

    /**
     * Start signing in to a web server: it's switched to signing in if it
     * wasn't, Paperboard registers with its sign-in server, and the view gets
     * the page to open. The browser comes back to a loopback address here, or
     * on the user's device, which hands it over with finishSignIn.
     */
    signIn(name: unknown): Promise<ToolsView> {
        return this.lock.run(async () => {
            this.writable();
            const spec = this.config.servers.find((s) => s.name === name);
            if (!spec) throw new Error("there's no such server");
            if (spec.transport !== "http") throw new Error(`${spec.name} is a program on this computer; it has nothing to sign in to`);
            this.cancelSignIn(spec.name);
            if (!spec.oauth) await this.put({ ...spec, oauth: true });
            const listener = new Callback();
            try {
                const redirect = await listener.listen(
                    (address) => this.arrive(spec.name, address, true),
                    () => {
                        const p = this.signIns.get(spec.name);
                        return !p || p.listener !== listener || p.error !== null;
                    },
                );
                const found = await discover(this.fetcher, spec.url);
                const client = await register(this.fetcher, found, redirect);
                const { verifier, challenge } = pkcePair();
                const state = crypto.randomBytes(16).toString("base64url");
                const pending: Pending = {
                    url: authorizeUrl(found, client.clientId, redirect, state, challenge),
                    callback: redirect,
                    error: null,
                    state,
                    verifier,
                    client: { ...client, tokenEndpoint: found.tokenEndpoint, resource: found.resource },
                    listener,
                    finishing: false,
                    timer: setTimeout(() => this.failSignIn(spec.name, "the sign-in wasn't finished in time; start it again"), SIGN_IN_MS),
                };
                this.signIns.set(spec.name, pending);
            } catch (e) {
                listener.close();
                throw e;
            }
            this.changed();
            return this.view();
        });
    }

    /** The address the browser came back to, caught on the user's device. */
    async finishSignIn(name: unknown, address: unknown): Promise<ToolsView> {
        if (typeof name !== "string" || typeof address !== "string") throw new Error("which server, and the address the browser ended on");
        const failure = await this.arrive(name, address, false);
        if (failure) throw new Error(failure);
        return this.view();
    }

    cancelSignInFor(name: unknown): Promise<ToolsView> {
        if (typeof name === "string") this.cancelSignIn(name);
        this.changed();
        return this.view();
    }

    /** End a sign-in. One ended by the browser's own visit keeps its listener until the page is sent; the listener closes itself then. */
    private cancelSignIn(name: string, keepListener = false) {
        const p = this.signIns.get(name);
        if (!p) return;
        clearTimeout(p.timer);
        if (!keepListener) p.listener.close();
        this.signIns.delete(name);
    }

    private failSignIn(name: string, why: string, keepListener = false) {
        const p = this.signIns.get(name);
        if (!p) return;
        clearTimeout(p.timer);
        if (!keepListener) p.listener.close();
        p.error = why;
        p.finishing = false;
        this.changed();
    }

    /** The browser came back: trade the code for tokens. Resolves with why it failed, or null. */
    private async arrive(name: string, address: string, fromListener: boolean): Promise<string | null> {
        const p = this.signIns.get(name);
        if (!p || p.error) return "this sign-in isn't waiting anymore; start it again";
        if (p.finishing) return null;
        let url: URL;
        try {
            url = new URL(address);
        } catch (e) {
            console.warn(`[agents] ${name}'s sign-in came back to an address that isn't a URL:`, errorMessage(e));
            return "that isn't the address the sign-in came back to";
        }
        const expected = new URL(p.callback);
        if (url.origin !== expected.origin || url.pathname !== expected.pathname) return "that isn't the address the sign-in came back to";
        if (url.searchParams.get("state") !== p.state) return "that address is from a different sign-in";
        const refused = url.searchParams.get("error");
        if (refused) {
            const why = `the sign-in was refused: ${url.searchParams.get("error_description") ?? refused}`;
            this.failSignIn(name, why, fromListener);
            return why;
        }
        const code = url.searchParams.get("code");
        if (!code) return "the address has no sign-in code";
        p.finishing = true;
        try {
            const tokens = await exchange(this.fetcher, p.client, code, p.callback, p.verifier);
            // canceled, removed or started again while the code was traded: that stands, and
            // this one writes nothing. Under the lock, so none of those lands mid-write
            const ended = await this.lock.run(async () => {
                if (this.signIns.get(name) !== p) return true;
                await this.deps.vault.set(vaultName(name, OAUTH_SECRET), JSON.stringify(tokens));
                this.cancelSignIn(name, fromListener);
                return false;
            });
            if (ended) return "this sign-in ended while its code was traded; start it again";
        } catch (e) {
            const why = errorMessage(e);
            console.error(`[agents] ${name}'s sign-in couldn't trade its code for tokens:`, why);
            if (this.signIns.get(name) === p) this.failSignIn(name, why, fromListener);
            return why;
        }
        // it starts again with the tokens, now rather than at the next turn
        const e = this.entries.get(name);
        if (e && e.spec.enabled) {
            e.needsSignIn = false;
            await this.lock.run(async () => {
                await this.stop(e);
                await this.start(e);
            });
        }
        this.changed();
        return null;
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
            return { isError: true, text: `${server}: ${errorMessage(err)}` };
        }
    }

    /** Stop every server and observe each one gone. */
    async shutdown(): Promise<void> {
        this.closed = true;
        for (const name of [...this.signIns.keys()]) this.cancelSignIn(name);
        const results = await Promise.allSettled([...this.entries.values()].map((e) => this.stop(e)));
        const failures = results.flatMap((r) => (r.status === "rejected" ? [errorMessage(r.reason)] : []));
        if (failures.length) throw new Error(`tool servers didn't all stop: ${failures.join("; ")}`);
    }
}
