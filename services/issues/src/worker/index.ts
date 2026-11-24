// issues.ariapis.com: the app posts what a person typed in Report an Issue
// to POST /v1/issues, and /dashboard (behind Cloudflare Access) lists them,
// each downloadable as a prompt for a coding agent.
import {
    CONTEXT_KEYS,
    MAX_BODY_BYTES,
    MAX_CONTEXT_LENGTH,
    MAX_DETAILS_LENGTH,
    MAX_TEXT_LENGTH,
    SHELLS,
    SUBMIT_PATH,
    type IssueContext,
    type IssueSubmission,
} from "../shared";
import { accessEmail } from "./access";
import { issueFileName, issuePrompt } from "./prompt";
import type { IssueStore } from "./store";

export { IssueStore } from "./store";
export { DAILY_LIMIT, STORE_LIMIT } from "./limits";

export interface Env {
    ISSUES: DurableObjectNamespace<IssueStore>;
    SUBMIT_LIMIT: RateLimit;
    ASSETS: Fetcher;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
}

// the one store every request reaches; keep the name across releases
export const STORE_NAME = "issues-v1";

class Failure extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly headers: Record<string, string> = {},
    ) {
        super(message);
    }
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
// the dashboard is never framed or cached, and its links tell no one where they came from
const DASHBOARD_HEADERS = { ...NO_STORE, "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const invalid = (message: string) => new Failure(400, "invalid_issue", message);

// control characters other than tab and line breaks have no place in a report
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// The context lands in an agent's instructions (prompt.ts), so each field is
// held to the shape the app really sends, never a line a person could word.
const CONTEXT_SHAPES: Record<Exclude<keyof IssueContext, "shell">, RegExp> = {
    appVersion: /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?(?:\+[0-9A-Za-z.-]{1,40})?$/,
    os: /^(?:macOS|Windows|Linux)$/,
    osVersion: /^[0-9A-Za-z._-]+$/,
    // Node's process.arch names
    arch: /^(?:arm|arm64|ia32|loong64|mips|mipsel|ppc|ppc64|riscv64|s390|s390x|x64)$/,
};

function contextOf(value: unknown): IssueContext {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("context must be an object.");
    const given = value as Record<string, unknown>;
    const unknown = Object.keys(given).filter((key) => !(CONTEXT_KEYS as readonly string[]).includes(key));
    if (unknown.length) throw invalid(`context has unknown fields: ${unknown.join(", ")}.`);
    for (const key of CONTEXT_KEYS) {
        const field = given[key];
        if (typeof field !== "string" || !field.trim() || field.length > MAX_CONTEXT_LENGTH || CONTROL.test(field) || /[\r\n]/.test(field)) {
            throw invalid(`context.${key} must be one line of at most ${MAX_CONTEXT_LENGTH} characters.`);
        }
    }
    for (const [key, shape] of Object.entries(CONTEXT_SHAPES)) {
        if (!shape.test(given[key] as string)) throw invalid(`context.${key} isn't a value the app sends.`);
    }
    if (!(SHELLS as readonly string[]).includes(given.shell as string)) throw invalid(`context.shell must be ${SHELLS.join(" or ")}.`);
    return given as unknown as IssueContext;
}

function submissionOf(value: unknown): IssueSubmission {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("The body must be a JSON object.");
    const { text, context, details, ...rest } = value as Record<string, unknown>;
    if (Object.keys(rest).length) throw invalid(`Unknown fields: ${Object.keys(rest).join(", ")}.`);
    if (typeof text !== "string") throw invalid("text must be a string.");
    const trimmed = text.trim();
    if (!trimmed) throw invalid("Say what went wrong.");
    if (trimmed.length > MAX_TEXT_LENGTH) throw invalid(`An issue holds at most ${MAX_TEXT_LENGTH} characters.`);
    if (CONTROL.test(trimmed)) throw invalid("text holds control characters.");
    if (typeof details !== "string") throw invalid("details must be a string.");
    if (details.length > MAX_DETAILS_LENGTH) throw invalid(`details hold at most ${MAX_DETAILS_LENGTH} characters.`);
    if (CONTROL.test(details)) throw invalid("details hold control characters.");
    return { text: trimmed.replace(/\r\n?/g, "\n"), context: contextOf(context), details: details.trim().replace(/\r\n?/g, "\n") };
}

const tooLarge = () => new Failure(413, "too_large", `The request is over ${MAX_BODY_BYTES} bytes.`);

// reads at most MAX_BODY_BYTES, whatever Content-Length claims
async function boundedText(request: Request): Promise<string> {
    const declared = request.headers.get("Content-Length");
    if (declared !== null && Number(declared) > MAX_BODY_BYTES) throw tooLarge();
    if (!request.body) return "";
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            throw tooLarge();
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
        // quiet: answered as the 400 below
        throw invalid("The body isn't UTF-8.");
    }
}

const store = (env: Env) => env.ISSUES.get(env.ISSUES.idFromName(STORE_NAME));

async function submit(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") throw new Failure(405, "method_not_allowed", "Send issues with POST.", { Allow: "POST" });
    // set by Cloudflare's edge, never by the caller
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) throw new Failure(400, "no_client", "The request has no client address.");
    if (!(await env.SUBMIT_LIMIT.limit({ key: ip })).success) {
        throw new Failure(429, "rate_limited", "Too many issues from this address. Try again in a minute.", { "Retry-After": "60" });
    }
    // a JSON type makes a cross-site browser post preflight, which this service never answers
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
        throw new Failure(415, "unsupported_type", "Send the issue as application/json.");
    }
    const raw = await boundedText(request);
    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        // quiet: answered as the 400 below
        throw invalid("The body isn't JSON.");
    }
    const added = await store(env).add(submissionOf(body));
    if (!added.ok) {
        throw added.reason === "daily_limit"
            ? new Failure(429, "busy", "Paperboard is getting a lot of issues right now. Try again later.", { "Retry-After": "3600" })
            : new Failure(503, "full", "Paperboard can't take more issues right now. Try again later.");
    }
    return json({ id: added.issue.id }, 201);
}

const ISSUE_ROUTE = /^\/dashboard\/api\/issues\/([0-9a-f-]{36})(\/prompt)?$/;

async function dashboard(request: Request, env: Env, url: URL): Promise<Response> {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new Failure(503, "not_configured", "The dashboard has no Access application set.");
    let email: string | null;
    try {
        email = await accessEmail(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD });
    } catch (err) {
        console.error("Access keys couldn't be read:", err instanceof Error ? err.message : String(err));
        throw new Failure(503, "access_unavailable", "Couldn't check the sign-in. Try again in a moment.");
    }
    if (!email) throw new Failure(403, "forbidden", "Sign in through Cloudflare Access to see the dashboard.");

    if (!url.pathname.startsWith("/dashboard/api/")) {
        if (request.method !== "GET" && request.method !== "HEAD") throw new Failure(405, "method_not_allowed", "The dashboard only reads.", { Allow: "GET, HEAD" });
        const asset = await env.ASSETS.fetch(request);
        const answer = new Response(asset.body, asset);
        for (const [name, value] of Object.entries(DASHBOARD_HEADERS)) answer.headers.set(name, value);
        return answer;
    }

    if (url.pathname === "/dashboard/api/issues") {
        if (request.method !== "GET") throw new Failure(405, "method_not_allowed", "List issues with GET.", { Allow: "GET" });
        const before = Number(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
        if (!Number.isSafeInteger(before)) throw invalid("before must be a time in milliseconds.");
        return json(await store(env).list(before), 200, DASHBOARD_HEADERS);
    }
    const match = ISSUE_ROUTE.exec(url.pathname);
    if (!match) throw new Failure(404, "not_found", "No such dashboard route.");
    const [, id, prompt] = match as unknown as [string, string, string | undefined];
    if (!prompt && request.method === "GET") {
        const issue = await store(env).get(id);
        if (!issue) throw new Failure(404, "not_found", "That issue is gone.");
        return json({ issue }, 200, DASHBOARD_HEADERS);
    }
    if (prompt) {
        if (request.method !== "GET") throw new Failure(405, "method_not_allowed", "Download a prompt with GET.", { Allow: "GET" });
        const issue = await store(env).get(id);
        if (!issue) throw new Failure(404, "not_found", "That issue is gone.");
        return new Response(issuePrompt(issue), {
            headers: {
                ...DASHBOARD_HEADERS,
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="${issueFileName(issue)}"`,
            },
        });
    }
    if (request.method !== "DELETE") throw new Failure(405, "method_not_allowed", "Delete an issue with DELETE.", { Allow: "DELETE" });
    // only the dashboard's own page deletes
    if (request.headers.get("Origin") !== url.origin) throw new Failure(403, "forbidden", "Delete issues from the dashboard.");
    if (!(await store(env).remove(id))) throw new Failure(404, "not_found", "That issue is gone.");
    return new Response(null, { status: 204, headers: DASHBOARD_HEADERS });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        try {
            if (url.pathname === SUBMIT_PATH) return await submit(request, env);
            if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) return await dashboard(request, env, url);
            throw new Failure(404, "not_found", "Nothing is here.");
        } catch (err) {
            if (err instanceof Failure) return json({ error: { code: err.code, message: err.message } }, err.status, err.headers);
            console.error("issues failed:", err instanceof Error ? err.stack : String(err));
            return json({ error: { code: "internal", message: "Something went wrong on Paperboard's side." } }, 500);
        }
    },
} satisfies ExportedHandler<Env>;
