import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import type { BrainsHost } from "../src/service/brains";
import { Providers, SERVER_PROCESS_ID, toProvider } from "../src/service/providers";
import { FakeProcesses, until } from "./fakeHost";

// five of OpenCode 2.2's real integrations, as `GET /api/integration` returned them
const INTEGRATIONS = JSON.parse(fs.readFileSync(new URL("./fixtures/opencodeIntegrations.json", import.meta.url), "utf8")) as { id: string }[];
const entry = (id: string) => INTEGRATIONS.find((i) => i.id === id) as never;

describe("what OpenCode says a provider can do", () => {
    test("a key provider has one way to connect", () => {
        expect(toProvider(entry("anthropic"))).toMatchObject({
            id: "anthropic",
            name: "Anthropic",
            connected: false,
            unsupported: null,
            methods: [{ id: null, kind: "key", label: "API key", fields: [] }],
        });
    });

    test("OpenAI adds its sign-in pages beside the key", () => {
        const openai = toProvider(entry("openai"));
        expect(openai.methods.map((m) => [m.kind, m.id])).toEqual([
            ["key", null],
            ["oauth", "chatgpt-token-sharing"],
            ["oauth", "chatgpt-browser"],
            ["oauth", "chatgpt-headless"],
        ]);
        expect(openai.methods[1]!.label).toBe("Sign in with ChatGPT");
    });

    test("a sign-in with a form brings its fields, their choices and when they show", () => {
        const copilot = toProvider(entry("github-copilot"));
        const device = copilot.methods.find((m) => m.id === "device")!;
        expect(device.fields.map((f) => f.key)).toEqual(["deploymentType", "enterpriseUrl"]);
        expect(device.fields[0]!.options!.map((o) => o.value)).toEqual(["github.com", "enterprise"]);
        expect(device.fields[1]!.when).toEqual([{ key: "deploymentType", op: "eq", value: "enterprise" }]);
        // the environment variable it would also take is not a way to connect from here
        expect(copilot.methods.every((m) => m.kind === "oauth")).toBe(true);
    });

    test("a hidden field keeps its default, so the sign-in can send it", () => {
        const console = toProvider(entry("opencode")).methods.find((m) => m.id === "device")!;
        expect(console.fields).toEqual([expect.objectContaining({ key: "server", hidden: true, default: "https://opencode.ai/console" })]);
    });

    test("a provider with no way this panel drives says what to do instead of offering nothing", () => {
        const p = toProvider({ id: "x", name: "X", methods: [{ type: "external", id: "aws", label: "AWS profile" }, { type: "env", names: ["X_KEY", "X_TOKEN"] }], connections: [] } as never);
        expect(p.methods).toEqual([]);
        expect(p.unsupported).toBe("Set X_KEY or X_TOKEN in the environment OpenCode runs in.");
        expect(toProvider({ id: "y", name: "Y", methods: [{ type: "command", id: "c", label: "c", command: ["y"] }], connections: [] } as never).unsupported).toContain("some other way");
        // a form with a field that isn't text is left to OpenCode's own screens
        expect(toProvider({ id: "z", name: "Z", methods: [{ type: "key", form: [{ key: "n", type: "number" }] }], connections: [] } as never).methods).toEqual([]);
    });

    test("credentials make a provider connected, and only a saved credential can be taken back", () => {
        const p = toProvider({ id: "or", name: "OpenRouter", methods: [{ type: "key" }], connections: [{ type: "credential", id: "cred_1", label: "Work key" }, { type: "env", id: "env" }] } as never);
        expect(p.connected).toBe(true);
        expect(p.connections).toEqual([{ id: "cred_1", label: "Work key" }]);
    });
});

describe("talking to OpenCode's server", () => {
    let server: ReturnType<typeof Bun.serve> | null = null;
    afterEach(() => {
        server?.stop(true);
        server = null;
    });

    /** a stand-in for `opencode serve`: the same HTTP routes and basic auth, over a real socket */
    function setup(handler: (req: Request, body: unknown) => Response | Promise<Response>) {
        const procs = new FakeProcesses();
        let password = "";
        const seen: { method: string; path: string; body: unknown }[] = [];
        server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(req) {
                const url = new URL(req.url);
                if (req.headers.get("authorization") !== `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`) return Response.json({ message: "Authentication required" }, { status: 401 });
                if (url.pathname === "/api/info") return Response.json({ version: "2.2.5" });
                const text = await req.text();
                const body = text ? JSON.parse(text) : undefined;
                seen.push({ method: req.method, path: url.pathname, body });
                return handler(req, body);
            },
        });
        let changed = 0;
        procs.onStart = (o) => void (password = o.env!.OPENCODE_SERVER_PASSWORD!);
        const providers = new Providers({
            host: { start: procs.start, kill: procs.kill, exists: procs.exists, onStdout: procs.onStdout, onStderr: procs.onStderr, onExit: procs.onExit, write: procs.write } as unknown as BrainsHost,
            program: () => "/packages/opencode/bin/opencode",
            env: () => ({ XDG_DATA_HOME: "/brains/opencode/data" }),
            cwd: "/brains/opencode",
            onChange: async () => void changed++,
            port: async () => server!.port as number,
            idleMs: 60_000,
        });
        return { providers, procs, seen, changed: () => changed };
    }

    test("starts the server on a loopback port behind a password of its own, and lists the providers", async () => {
        const s = setup(() => Response.json({ data: INTEGRATIONS }));
        const list = await s.providers.list();
        const started = s.procs.started[0]!;
        expect(started.id).toBe(SERVER_PROCESS_ID);
        expect(started.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", String(server!.port)]);
        expect(started.env).toMatchObject({ XDG_DATA_HOME: "/brains/opencode/data" });
        expect(started.env!.OPENCODE_SERVER_PASSWORD).toMatch(/^[a-f0-9]{48}$/);
        expect(list.map((p) => p.id).sort()).toEqual(INTEGRATIONS.map((i) => i.id).sort());
        // one server serves every call
        await s.providers.list();
        expect(s.procs.started).toHaveLength(1);
        await s.providers.stop();
    });

    test("a key goes to OpenCode's key route, once, and the brain is told it changed", async () => {
        const s = setup(() => new Response(null, { status: 204 }));
        await s.providers.connectKey("openrouter", "  sk-or-123  ", { region: "eu" });
        expect(s.seen).toEqual([{ method: "POST", path: "/api/integration/openrouter/connect/key", body: { key: "sk-or-123", answer: { region: "eu" } } }]);
        expect(s.changed()).toBe(1);
        await expect(s.providers.connectKey("openrouter", "   ", undefined)).rejects.toThrow("Paste the provider's API key");
        await expect(s.providers.connectKey("../credential", "k", undefined)).rejects.toThrow("isn't a provider id");
        await s.providers.stop();
    });

    test("a refusal is OpenCode's own words, with its status", async () => {
        const s = setup(() => Response.json({ _tag: "InvalidRequestError", message: "key is not valid for this provider" }, { status: 400 }));
        await expect(s.providers.connectKey("openrouter", "bad", undefined)).rejects.toThrow("OpenCode refused (400): key is not valid for this provider");
        expect(s.changed()).toBe(0);
        await s.providers.stop();
    });

    test("a sign-in page: begun, waited on, finished; the server stays up for it and not after", async () => {
        let status: unknown = { status: "pending" };
        const s = setup((req) => {
            if (req.method === "POST") return Response.json({ data: { attemptID: "con_1", url: "https://github.com/login/device", instructions: "Enter code: 24F1-A4BB", mode: "auto", time: { created: 1, expires: 2 } } });
            return Response.json({ data: status });
        });
        const attempt = await s.providers.begin("github-copilot", "device", { deploymentType: "github.com" });
        expect(attempt).toEqual({ id: "con_1", url: "https://github.com/login/device", instructions: "Enter code: 24F1-A4BB", mode: "auto" });
        expect(s.seen[0]).toEqual({ method: "POST", path: "/api/integration/github-copilot/connect/oauth", body: { methodID: "device", answer: { deploymentType: "github.com" } } });

        expect(await s.providers.attempt("github-copilot", "con_1")).toEqual({ status: "pending" });
        // waiting on a sign-in keeps the server: OpenCode's own commands must not run beside it
        expect(await s.providers.quiet()).toBe(false);
        expect(s.procs.killed).toEqual([]);

        status = { status: "complete" };
        expect(await s.providers.attempt("github-copilot", "con_1")).toEqual({ status: "complete" });
        expect(s.changed()).toBe(1);
        expect(await s.providers.quiet()).toBe(true);
        expect(s.procs.killed.map((k) => k.id)).toEqual([SERVER_PROCESS_ID]);
    });

    test("a code mode sign-in sends the code the page showed, and failures keep their message", async () => {
        let status: unknown = { status: "failed", message: "the code has expired" };
        const s = setup((req) => (req.method === "POST" && req.url.endsWith("/connect/oauth") ? Response.json({ data: { attemptID: "con_2", url: "https://x.example/", instructions: "", mode: "code" } }) : req.url.endsWith("/complete") ? new Response(null, { status: 204 }) : Response.json({ data: status })));
        await s.providers.begin("gitlab", "oauth", undefined);
        expect(await s.providers.attempt("gitlab", "con_2", " 123-456 ")).toEqual({ status: "failed", message: "the code has expired" });
        expect(s.seen.map((r) => r.path)).toEqual(["/api/integration/gitlab/connect/oauth", "/api/integration/gitlab/connect/oauth/con_2/complete", "/api/integration/gitlab/connect/oauth/con_2"]);
        expect(s.seen[1]!.body).toEqual({ code: "123-456" });
        // nothing is waiting any more
        expect(await s.providers.quiet()).toBe(true);
        status = { status: "weird" };
        await expect(s.providers.attempt("gitlab", "con_2")).rejects.toThrow("doesn't know: weird");
    });

    test("a server that never answers is an error, not a hang", async () => {
        const s = setup(() => new Response(null, { status: 204 }));
        s.procs.onStart = () => {
            server!.stop(true);
        };
        const providers = new Providers({
            host: { start: s.procs.start, kill: s.procs.kill, exists: s.procs.exists, onStdout: s.procs.onStdout, onStderr: s.procs.onStderr, onExit: s.procs.onExit, write: s.procs.write } as unknown as BrainsHost,
            program: () => "/p/opencode",
            env: () => ({}),
            cwd: "/x",
            onChange: async () => {},
            port: async () => 1,
            fetch: (async () => {
                throw new Error("connection refused");
            }) as unknown as typeof fetch,
        });
        // the process dies at once: its exit is the error
        s.procs.onStart = () => queueMicrotask(() => s.procs.exit(SERVER_PROCESS_ID, 3));
        await expect(providers.list()).rejects.toThrow("provider server stopped (exit 3)");
        await until(() => true);
    });

    test("without OpenCode installed there is nothing to start", async () => {
        const s = setup(() => new Response(null, { status: 204 }));
        const none = new Providers({ host: {} as BrainsHost, program: () => null, env: () => ({}), cwd: "/x", onChange: async () => {} });
        await expect(none.list()).rejects.toThrow("OpenCode isn't installed yet");
        expect(s.procs.started).toEqual([]);
    });
});
