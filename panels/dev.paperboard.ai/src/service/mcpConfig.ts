// tools.json: which tool servers the agent has, validated by the service
// that owns them. Anything the UI checked is checked again here.
//
// Rules that matter beyond shape: a stdio server is an argv array (never a
// shell line), and a secret never lives in the config, only the name of the
// vault entry that holds it.

import { DEFAULT_TOOLS, TOOL_LIMITS as L, type ServerSpec, type ServerValue, type ToolsConfig } from "../toolsContract";

const NAME = /^[a-z][a-z0-9-]*$/;
// names the agent's own tool names or the service use
const RESERVED_NAMES = new Set(["mcp", "paperboard", "computer", "actions", "action"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const SECRET_NAME = /^[A-Za-z0-9_.-]+$/;
// the daemon refuses these in a child's env anyway (the credential is issued, not chosen); refuse early and clearly
const RESERVED_ENV = /^(PAPERCRANE_|PAPERBOARD_)/i;
const HEADERS_WE_SET = new Set(["host", "content-length", "content-type", "accept", "mcp-session-id", "transfer-encoding", "connection"]);
// a value under a name like this, written out in the config, is a secret in plaintext
const SECRETISH_NAME = /(token|secret|key|passw|auth|credential|cookie|session)/i;
// and some values give themselves away
const SECRETISH_VALUE = /^(bearer |basic |sk-|ghp_|gho_|github_pat_|xox[abprs]-|AKIA|AIza)/i;
const SECRETISH_QUERY = /^(token|access_token|api_?key|key|secret|password|auth|authorization|sig|signature)$/i;

const fail = (m: string): never => {
    throw new Error(m);
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function exactKeys(o: Record<string, unknown>, allowed: string[], what: string) {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${what}: "${k}" isn't a setting`);
}

function text(v: unknown, what: string, max: number): string {
    if (typeof v !== "string") return fail(`${what} must be text`);
    if (v.length > max) return fail(`${what} is limited to ${max} characters`);
    if (v.includes("\0")) return fail(`${what} can't contain a NUL character`);
    return v;
}

function parseValues(raw: unknown, what: string, kind: "env" | "headers", max: number): Record<string, ServerValue> {
    if (raw === undefined) return {};
    if (!isRecord(raw)) return fail(`${what} must be a list of name and value`);
    const entries = Object.entries(raw);
    if (entries.length > max) fail(`${what} is limited to ${max} entries`);
    const out: Record<string, ServerValue> = {};
    for (const [name, v] of entries) {
        if (kind === "env") {
            if (!ENV_NAME.test(name) || name.length > L.envName) fail(`${what}: "${name}" isn't a valid variable name`);
            if (RESERVED_ENV.test(name)) fail(`${what}: ${name} is reserved for Paperboard`);
        } else {
            if (!HEADER_NAME.test(name) || name.length > L.envName) fail(`${what}: "${name}" isn't a valid header name`);
            if (HEADERS_WE_SET.has(name.toLowerCase())) fail(`${what}: ${name} is set by the connection itself`);
        }
        if (isRecord(v)) {
            exactKeys(v, ["secret"], `${what} ${name}`);
            const secret = text(v.secret, `${what} ${name}'s secret name`, L.secretName);
            if (!secret || !SECRET_NAME.test(secret)) fail(`${what} ${name}: a secret's name uses letters, digits, . _ -`);
            out[name] = { secret };
            continue;
        }
        const value = text(v, `${what} ${name}`, kind === "env" ? L.envValue : L.headerValue);
        if (value && (SECRETISH_NAME.test(name) || SECRETISH_VALUE.test(value))) {
            fail(`${what} ${name} looks like a secret. Keep it in the vault: save it as a secret and the config keeps only its name.`);
        }
        out[name] = value;
    }
    return out;
}

/** One server, as the user wrote it. */
export function parseServer(raw: unknown): ServerSpec {
    if (!isRecord(raw)) return fail("a server is a set of settings");
    const name = text(raw.name, "the name", L.name);
    if (!name || !NAME.test(name)) fail("a server's name is lowercase letters, digits and dashes, starting with a letter");
    if (RESERVED_NAMES.has(name)) fail(`"${name}" is reserved; pick another name`);
    const enabled: unknown = raw.enabled === undefined ? true : raw.enabled;
    if (typeof enabled !== "boolean") return fail("enabled is on or off");
    const transport = raw.transport;
    const where: unknown = raw.where === undefined ? "host" : raw.where;
    if (where !== "host" && where !== "computer") return fail('where is "host" (this computer) or "computer" (its computer)');
    if (transport === "stdio") {
        exactKeys(raw, ["name", "where", "transport", "command", "args", "env", "enabled"], name);
        const command = text(raw.command, "the command", L.command);
        if (!command.trim()) fail("the command is empty");
        if (/[\r\n]/.test(command)) fail("the command is one program, not a script");
        if (command.startsWith("-")) fail("the command can't start with a dash");
        // "npx -y foo" in one field is the usual mistake: the arguments go in their own list
        if (/\s/.test(command) && !command.startsWith("/")) fail("the command is just the program; put its arguments in the argument list");
        const rawArgs = raw.args === undefined ? [] : raw.args;
        if (!Array.isArray(rawArgs)) return fail("arguments are a list");
        if (rawArgs.length > L.args) fail(`at most ${L.args} arguments`);
        const args = rawArgs.map((a, i) => text(a, `argument ${i + 1}`, L.arg));
        return { name, where, transport, command, args, env: parseValues(raw.env, "environment", "env", L.env), enabled };
    }
    if (transport === "http") {
        exactKeys(raw, ["name", "where", "transport", "url", "headers", "enabled"], name);
        if (where !== "host") fail("an HTTP server is reached from this computer, not from inside its computer");
        const url = text(raw.url, "the address", L.url).trim();
        let u: URL;
        try {
            u = new URL(url);
        } catch {
            throw new Error("the address isn't a valid URL");
        }
        if (u.protocol !== "http:" && u.protocol !== "https:") fail("the address must start with http:// or https://");
        if (u.username || u.password) fail("a password in the address would be saved in the config; use a header with a secret instead");
        for (const k of u.searchParams.keys()) {
            if (SECRETISH_QUERY.test(k)) fail(`the address carries "${k}" in plaintext; use a header with a secret instead`);
        }
        return { name, where: "host", transport, url, headers: parseValues(raw.headers, "headers", "headers", L.headers), enabled };
    }
    return fail('transport is "stdio" or "http"');
}

/** tools.json as stored. Absent is the default; anything malformed is an error, never quietly the default. */
export function parseToolsConfig(raw: unknown): ToolsConfig {
    if (raw === null || raw === undefined) return structuredClone(DEFAULT_TOOLS);
    if (!isRecord(raw)) return fail("tools.json isn't a set of settings");
    if (Object.keys(raw).length === 0) return structuredClone(DEFAULT_TOOLS);
    exactKeys(raw, ["actions", "servers"], "tools.json");
    const actions = raw.actions === undefined ? DEFAULT_TOOLS.actions : raw.actions;
    if (typeof actions !== "boolean") fail("tools.json: actions is on or off");
    const list = raw.servers === undefined ? [] : raw.servers;
    if (!Array.isArray(list)) return fail("tools.json: servers is a list");
    if (list.length > L.servers) fail(`at most ${L.servers} servers`);
    const servers = list.map((s) => parseServer(s));
    if (servers.filter((s) => s.enabled).length > L.running) fail(`at most ${L.running} servers can be on at once; switch some off`);
    const seen = new Set<string>();
    for (const s of servers) {
        if (seen.has(s.name)) fail(`two servers are named "${s.name}"`);
        seen.add(s.name);
    }
    return { actions: actions as boolean, servers };
}

/** the vault entry a server's secret lives in */
export const vaultName = (server: string, secret: string) => `mcp.${server}.${secret}`;

/** every secret name a server's spec points at */
export function secretNames(s: ServerSpec): string[] {
    const values = Object.values(s.transport === "stdio" ? s.env : s.headers);
    return [...new Set(values.flatMap((v) => (typeof v === "string" ? [] : [v.secret])))];
}

export function checkSecretName(name: unknown): string {
    const s = text(name, "the secret's name", L.secretName);
    if (!s || !SECRET_NAME.test(s)) fail("a secret's name uses letters, digits, . _ -");
    return s;
}
