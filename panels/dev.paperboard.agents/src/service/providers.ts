// OpenCode's providers, the way its own /connect shows them but without its
// terminal screen. OpenCode 2 serves the lot over a local HTTP API: every
// provider it knows (`/api/integration`) with the ways to connect each (a key,
// or a sign-in page), and calls to connect, finish a sign-in and take a
// credential back. This panel starts that server when asked, on a loopback
// port behind a one-time password, and stops it when nothing is pending.
//
// Keys go straight from the user's field to OpenCode's server and are kept
// nowhere here; OpenCode stores them in its own folder.

import crypto from "node:crypto";
import net from "node:net";
import type { ProviderAttempt, ProviderAttemptStatus, ProviderField, ProviderInfo, ProviderMethod } from "../contract";
import { errorText } from "../lib/failure";
import type { BrainsHost } from "./brains";

export const SERVER_PROCESS_ID = "brain-opencode-server";
const READY_MS = 30_000;
const IDLE_MS = 60_000;
const REQUEST_MS = 60_000;
const KEY_MAX = 4_096;

export interface ProvidersDeps {
    host: BrainsHost;
    /** OpenCode's program, null while it isn't installed */
    program: () => string | null;
    env: () => Record<string, string>;
    cwd: string;
    /** called after a credential was added or removed, so the brain's state follows */
    onChange: () => Promise<void>;
    /** a free loopback port; replaceable for tests */
    port?: () => Promise<number>;
    fetch?: typeof fetch;
    idleMs?: number;
}

/** A server's reply that isn't a success, in OpenCode's own words. */
class ProviderError extends Error {}

export class Providers {
    private server: { base: string; auth: string } | null = null;
    private starting: Promise<{ base: string; auth: string }> | null = null;
    private idle: ReturnType<typeof setTimeout> | null = null;
    /** sign-ins started and not finished: the server stays up for them */
    private pending = new Set<string>();

    constructor(private deps: ProvidersDeps) {}

    /** Every provider OpenCode can connect, and which are. */
    async list(): Promise<ProviderInfo[]> {
        const body = (await this.request("GET", "/api/integration")) as { data?: unknown };
        if (!Array.isArray(body?.data)) throw new ProviderError("OpenCode's provider list wasn't a list");
        const out = (body.data as RawIntegration[]).map(toProvider);
        // connected first, then by name
        return out.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    }

    async connectKey(provider: unknown, key: unknown, answer: unknown): Promise<void> {
        const id = idOf(provider);
        if (typeof key !== "string" || !key.trim() || key.trim().length > KEY_MAX) throw new Error("Paste the provider's API key.");
        await this.request("POST", `/api/integration/${id}/connect/key`, { key: key.trim(), answer: answersOf(answer) });
        await this.settled();
    }

    /** Begin a sign-in on a provider's page. The user opens `url`; `auto` ones finish by themselves. */
    async begin(provider: unknown, method: unknown, answer: unknown): Promise<ProviderAttempt> {
        const id = idOf(provider);
        if (typeof method !== "string" || !method) throw new Error("Which way to connect?");
        const body = (await this.request("POST", `/api/integration/${id}/connect/oauth`, { methodID: method, answer: answersOf(answer) })) as { data?: Record<string, unknown> };
        const d = body?.data;
        if (!d || typeof d.attemptID !== "string" || typeof d.url !== "string" || (d.mode !== "auto" && d.mode !== "code")) {
            throw new ProviderError("OpenCode's sign-in answer wasn't what was expected");
        }
        this.pending.add(`${id}/${d.attemptID}`);
        return { id: d.attemptID, url: d.url, instructions: typeof d.instructions === "string" ? d.instructions : "", mode: d.mode };
    }

    /** Where a sign-in stands; with a `code`, the one the page showed is given to OpenCode first. */
    async attempt(provider: unknown, attempt: unknown, code?: unknown): Promise<ProviderAttemptStatus> {
        const id = idOf(provider);
        const attemptId = idOf(attempt);
        if (code !== undefined && code !== null) {
            if (typeof code !== "string" || !code.trim() || code.trim().length > KEY_MAX) throw new Error("That isn't a sign-in code.");
            await this.request("POST", `/api/integration/${id}/connect/oauth/${attemptId}/complete`, { code: code.trim() });
        }
        const body = (await this.request("GET", `/api/integration/${id}/connect/oauth/${attemptId}`)) as { data?: { status?: unknown; message?: unknown } };
        const status = body?.data?.status;
        if (status === "failed") {
            this.pending.delete(`${id}/${attemptId}`);
            return { status: "failed", message: typeof body.data?.message === "string" ? body.data.message : "OpenCode didn't say why" };
        }
        if (status === "complete" || status === "expired") {
            this.pending.delete(`${id}/${attemptId}`);
            if (status === "complete") await this.settled();
            return { status };
        }
        if (status === "pending") return { status };
        throw new ProviderError(`OpenCode reported a sign-in state this panel doesn't know: ${String(status)}`);
    }

    async cancel(provider: unknown, attempt: unknown): Promise<void> {
        const id = idOf(provider);
        const attemptId = idOf(attempt);
        this.pending.delete(`${id}/${attemptId}`);
        await this.request("DELETE", `/api/integration/${id}/connect/oauth/${attemptId}`);
        this.arm();
    }

    async disconnect(credential: unknown): Promise<void> {
        await this.request("DELETE", `/api/credential/${idOf(credential)}`);
        await this.settled();
    }

    /** Stop the server unless a sign-in is waiting on it. True when it's down (OpenCode's own commands may run). */
    async quiet(): Promise<boolean> {
        if (this.pending.size > 0) return false;
        await this.stop();
        return true;
    }

    async stop(): Promise<void> {
        if (this.idle) clearTimeout(this.idle);
        this.idle = null;
        this.pending.clear();
        this.server = null;
        this.starting = null;
        if (await this.deps.host.exists(SERVER_PROCESS_ID)) {
            const gone = new Promise<void>((ok) => {
                const off = this.deps.host.onExit(SERVER_PROCESS_ID, () => {
                    off();
                    ok();
                });
            });
            await this.deps.host.kill(SERVER_PROCESS_ID, "SIGTERM");
            await gone;
        }
    }

    // ------------------------------------------------------------- internals

    /** A change was made: tell the brain, and let the server go once nothing waits on it. */
    private async settled() {
        await this.deps.onChange();
        this.arm();
    }

    private arm() {
        if (this.idle) clearTimeout(this.idle);
        this.idle = setTimeout(() => {
            this.idle = null;
            void this.quiet().then(
                (down) => down || this.arm(),
                (e) => console.error(`[ai] couldn't stop OpenCode's provider server: ${errorText(e)}`),
            );
        }, this.deps.idleMs ?? IDLE_MS);
    }

    private async connection(): Promise<{ base: string; auth: string }> {
        if (this.server) return this.server;
        this.starting ??= this.start().catch((e) => {
            this.starting = null;
            throw e;
        });
        return this.starting;
    }

    private async start(): Promise<{ base: string; auth: string }> {
        const program = this.deps.program();
        if (!program) throw new ProviderError("OpenCode isn't installed yet.");
        const port = await (this.deps.port ?? freePort)();
        const password = crypto.randomBytes(24).toString("hex");
        const base = `http://127.0.0.1:${port}`;
        const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
        let stderr = "";
        const offs = [this.deps.host.onStderr(SERVER_PROCESS_ID, (d) => (stderr = (stderr + d).slice(-2000)))];
        let died: string | null = null;
        offs.push(
            this.deps.host.onExit(SERVER_PROCESS_ID, (code) => {
                died = `OpenCode's provider server stopped (exit ${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" | ")}` : ""}`;
                this.server = null;
                this.starting = null;
            }),
        );
        try {
            await this.deps.host.start({
                id: SERVER_PROCESS_ID,
                command: program,
                args: ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
                cwd: this.deps.cwd,
                env: { ...this.deps.env(), OPENCODE_SERVER_PASSWORD: password },
                stdin: false,
            });
            const end = Date.now() + READY_MS;
            for (;;) {
                if (died) throw new ProviderError(died);
                try {
                    const res = await (this.deps.fetch ?? fetch)(`${base}/api/info`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2_000) });
                    if (res.ok) break;
                } catch {
                    // not listening yet
                }
                if (Date.now() > end) throw new ProviderError("OpenCode's provider server didn't start in time");
                await new Promise((r) => setTimeout(r, 100));
            }
        } catch (e) {
            for (const off of offs) off();
            await this.deps.host.kill(SERVER_PROCESS_ID, "SIGTERM").catch(() => undefined);
            throw e;
        }
        this.server = { base, auth };
        return this.server;
    }

    private async request(method: string, path: string, body?: unknown): Promise<unknown> {
        const { base, auth } = await this.connection();
        const res = await (this.deps.fetch ?? fetch)(`${base}${path}`, {
            method,
            headers: { authorization: auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_MS),
        });
        if (res.status === 204) return null;
        const text = await res.text();
        let json: unknown = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            // an error page: reported below with its text
        }
        if (!res.ok) {
            const message = (json as { message?: unknown } | null)?.message;
            throw new ProviderError(`OpenCode refused (${res.status}): ${typeof message === "string" && message ? message : text.slice(0, 300) || res.statusText}`);
        }
        if (json === null) throw new ProviderError("OpenCode's answer wasn't JSON");
        return json;
    }
}

// ----------------------------------------------------------------- shapes

interface RawField {
    key?: unknown;
    title?: unknown;
    type?: unknown;
    required?: unknown;
    hidden?: unknown;
    placeholder?: unknown;
    default?: unknown;
    options?: { value?: unknown; label?: unknown; description?: unknown }[];
    when?: { key?: unknown; op?: unknown; value?: unknown }[];
}
interface RawMethod {
    id?: unknown;
    type?: unknown;
    label?: unknown;
    names?: unknown;
    form?: RawField[];
}
interface RawIntegration {
    id?: unknown;
    name?: unknown;
    methods?: RawMethod[];
    connections?: { id?: unknown; type?: unknown; label?: unknown }[];
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** A form this panel can render: every field is text (or a choice of text). Anything else is left to OpenCode's own screens. */
function fieldsOf(form: RawField[] | undefined): ProviderField[] | null {
    const out: ProviderField[] = [];
    for (const f of form ?? []) {
        const key = str(f.key);
        if (!key || f.type !== "string") return null;
        const when: ProviderField["when"] = [];
        for (const w of f.when ?? []) {
            if (!str(w.key) || (w.op !== "eq" && w.op !== "neq") || typeof w.value !== "string") return null;
            when.push({ key: w.key as string, op: w.op, value: w.value });
        }
        out.push({
            key,
            title: str(f.title) ?? key,
            required: f.required === true,
            hidden: f.hidden === true,
            placeholder: str(f.placeholder),
            default: str(f.default),
            options: Array.isArray(f.options) ? f.options.map((o) => ({ value: String(o.value), label: str(o.label) ?? String(o.value), description: str(o.description) })) : null,
            when,
        });
    }
    return out;
}

export function toProvider(raw: RawIntegration): ProviderInfo {
    const id = String(raw.id);
    const connections = (raw.connections ?? []).filter((c) => c.type === "credential" && str(c.id)).map((c) => ({ id: String(c.id), label: str(c.label) ?? "API key" }));
    const methods: ProviderMethod[] = [];
    const env: string[] = [];
    let skipped = false;
    for (const m of raw.methods ?? []) {
        if (m.type === "env") {
            if (Array.isArray(m.names)) env.push(...m.names.map(String));
            continue;
        }
        if (m.type !== "key" && m.type !== "oauth") {
            skipped = true;
            continue;
        }
        const fields = fieldsOf(m.form);
        if (!fields) {
            skipped = true;
            continue;
        }
        if (m.type === "oauth" && !str(m.id)) {
            skipped = true;
            continue;
        }
        methods.push({ id: m.type === "key" ? null : String(m.id), kind: m.type, label: str(m.label) ?? (m.type === "key" ? "API key" : "Sign in"), fields });
    }
    const unsupported = methods.length
        ? null
        : env.length
          ? `Set ${env.join(" or ")} in the environment OpenCode runs in.`
          : skipped
            ? "This provider connects some other way, which Paperboard doesn't drive yet."
            : "This provider has no way to connect.";
    return { id, name: str(raw.name) ?? id, connected: connections.length > 0 || (raw.connections ?? []).length > 0, connections, methods, unsupported };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function idOf(v: unknown): string {
    if (typeof v !== "string" || !ID.test(v)) throw new Error("That isn't a provider id.");
    return v;
}

/** A form's answers: text by field name. */
function answersOf(v: unknown): Record<string, string> | null {
    if (v === undefined || v === null) return null;
    if (typeof v !== "object" || Array.isArray(v)) throw new Error("A provider's form answers are text by field name.");
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
        if (typeof val !== "string" || val.length > KEY_MAX) throw new Error(`The answer for ${k} must be text.`);
        out[k] = val;
    }
    return out;
}

function freePort(): Promise<number> {
    return new Promise((ok, fail) => {
        const server = net.createServer();
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => ok(port));
        });
    });
}
