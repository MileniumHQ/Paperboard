import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { BrainState, Harness } from "../src/contract";
import { AiApp, type AppHost } from "../src/service/app";
import { Brains, loginProcessId } from "../src/service/brains";
import { CLAUDE_MEMORY_OFF } from "../src/service/harness";
import { askClaudeModels, listModels } from "../src/service/models";
import { conversationRig, settled, turnId, type Rig } from "./support/rig";
import { brainPackage, fakeEnv, fakeLog, packageHost, plan, Recorder, SLOW, tempDir, TestHost } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

type States = Record<Harness, BrainState>;

/** The brains, each installed from a package of fake brains, signed out. */
async function brains(o: { installed?: Harness[] } = {}) {
    const root = tempDir("brains");
    const host = new TestHost(fakeEnv(root));
    const installed = Object.fromEntries((o.installed ?? ["codex", "claude-code", "opencode"]).map((h) => [h, brainPackage(root, h)]));
    const states = new Recorder<States>();
    const b = new Brains({ host: { ...host, packages: packageHost(installed) } as never, dir: path.join(root, "storage", "brains"), onState: states.push });
    cleanups.push(async () => {
        await b.shutdown();
        await host.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    await b.init();
    return { root, host, b, states, installed };
}

// Harnesses run locked down and isolated.
describe("harness launch", () => {
    test("each brain runs from its package, with its own home in the panel's storage and auto-update off", async () => {
        const { root, b, installed } = await brains();
        // a codex on PATH is never the one used
        const elsewhere = path.join(root, "on-path");
        fs.mkdirSync(elsewhere);
        fs.copyFileSync(path.join(installed.codex!, "bin", "codex"), path.join(elsewhere, "codex"));
        expect(b.resolve("codex")).toBe(path.join(installed.codex!, "bin", "codex"));
        expect(b.resolve("claude-code")).toBe(path.join(installed["claude-code"]!, "bin", "claude"));
        const storage = path.join(root, "storage", "brains");
        expect(b.env("codex")).toEqual({ CODEX_HOME: path.join(storage, "codex") });
        expect(b.env("claude-code")).toEqual({ CLAUDE_CONFIG_DIR: path.join(storage, "claude"), DISABLE_AUTOUPDATER: "1" });
        const oc = b.env("opencode");
        expect(oc.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");
        for (const k of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) expect(oc[k]!.startsWith(path.join(storage, "opencode") + path.sep)).toBe(true);
        // the status checks ran with those homes, not the user's
        expect(fakeLog(root).filter((e) => e.name === "codex").every((e) => e.env.CODEX_HOME === path.join(storage, "codex"))).toBe(true);
    }, SLOW);

    test("Codex runs read-only with its own tools off, reaching only the panel's MCP server", async () => {
        let rig: Rig | null = await conversationRig({ harness: "codex" });
        cleanups.push(() => rig?.close());
        rig.conversation.send("hi");
        await settled(rig);
        const args = rig.host.startedAs(turnId)[0]!.args;
        const configs = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));
        const disabled = args.flatMap((a, i) => (args[i - 1] === "--disable" ? [a] : []));
        expect(configs).toContain('sandbox_mode="read-only"');
        expect(configs).toContain('approval_policy="never"');
        expect(configs).toContain("check_for_update_on_startup=false");
        for (const f of ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "multi_agent", "multi_agent_v2", "memories"]) expect(disabled).toContain(f);
        const servers = new Set(configs.filter((c) => c.startsWith("mcp_servers.")).map((c) => c.split(".")[1]));
        expect([...servers]).toEqual(["paperboard"]);
        expect(configs).toContain(`mcp_servers.paperboard.url=${JSON.stringify(rig.mcp.url)}`);
        expect(configs).toContain('mcp_servers.paperboard.bearer_token_env_var="PAPERBOARD_COMPUTER_MCP_TOKEN"');
    }, SLOW);

    test("Claude Code gets only WebSearch and Agent, with a strict MCP config naming only the panel's server", async () => {
        const rig = await conversationRig({ harness: "claude-code" });
        cleanups.push(() => rig.close());
        rig.conversation.send("hi");
        await settled(rig);
        const start = rig.host.startedAs(turnId)[0]!;
        const args = start.args;
        const after = (flag: string) => {
            const i = args.indexOf(flag);
            const out: string[] = [];
            for (let j = i + 1; j < args.length && !args[j]!.startsWith("--"); j++) out.push(args[j]!);
            return out;
        };
        expect(after("--tools")).toEqual(["WebSearch", "Agent"]);
        expect(after("--allowedTools")).toEqual(["WebSearch", "Agent", "mcp__paperboard"]);
        expect(args).toContain("--strict-mcp-config");
        expect(after("--permission-mode")).toEqual(["dontAsk"]);
        const mcp = JSON.parse(after("--mcp-config")[0]!);
        expect(Object.keys(mcp.mcpServers)).toEqual(["paperboard"]);
        expect(mcp.mcpServers.paperboard.url).toBe(rig.mcp.url);
        expect(start.env).toMatchObject({ ...CLAUDE_MEMORY_OFF, DISABLE_AUTO_COMPACT: "1" });
    }, SLOW);
});

// Brain sign-in input is checked.
describe("brain sign-in", () => {
    test("a pasted browser address must be the loopback callback's host, port and path, or nothing is requested", async () => {
        const { root, b, states } = await brains({ installed: ["codex"] });
        expect(b.snapshot().codex.phase).toBe("installed");
        // something else listening on this computer, which a pasted address must never reach
        const hits: string[] = [];
        const other = http.createServer((req, res) => {
            hits.push(req.url ?? "");
            res.end("hi");
        });
        await new Promise<void>((ok) => other.listen(0, "127.0.0.1", ok));
        cleanups.push(() => new Promise<void>((ok) => other.close(() => ok())));
        const otherPort = (other.address() as AddressInfo).port;

        await b.signIn("codex", "browser");
        await states.until((s) => !!s.at(-1)?.codex.login?.callback, "Codex's sign-in page");
        const callback = b.snapshot().codex.login!.callback!;
        const port = Number(new URL(callback).port);
        expect(callback).toBe(`http://127.0.0.1:${port}/auth/callback`);
        for (const bad of [
            `http://127.0.0.2:${port}/auth/callback?code=x`,
            `http://example.com:${port}/auth/callback?code=x`,
            `http://127.0.0.1:${otherPort}/auth/callback?code=x`,
            `http://localhost:${otherPort}/auth/callback?code=x`,
            `http://127.0.0.1:${port}/elsewhere?code=x`,
            `https://127.0.0.1:${port}/auth/callback?code=x`,
            `http://127.0.0.1:${port}/auth/callback`,
            42,
        ]) {
            await expect(b.finishAt("codex", bad)).rejects.toThrow(/That (isn't the address your browser ended on|address has no sign-in answer)/);
        }
        expect(hits).toEqual([]);
        expect(fakeLog(root).filter((e) => e.event === "callback")).toEqual([]);

        await b.finishAt("codex", `${callback}?code=the-answer&state=s`);
        await states.until((s) => s.at(-1)?.codex.phase === "ready", "Codex to be signed in");
        expect(fakeLog(root).filter((e) => e.event === "callback").map((e) => e.query)).toEqual(["?code=the-answer&state=s"]);
        expect(b.snapshot().codex).toMatchObject({ signedIn: true, account: "ChatGPT", login: null, error: null });
    }, SLOW);

    test("a pasted code goes to the login's input once, trimmed; bad codes are refused and no code is ever published", async () => {
        const { host, b, states } = await brains({ installed: ["claude-code"] });
        await b.signIn("claude-code");
        await states.until((s) => s.at(-1)?.["claude-code"].login?.expectsCode === true, "Claude's sign-in page");
        expect(b.snapshot()["claude-code"].login!.url).toStartWith("https://claude.com/cai/oauth/authorize?");
        for (const bad of ["", "   ", "line one\nline two", 42, null, "x".repeat(2001)]) {
            await expect(b.submitCode("claude-code", bad)).rejects.toThrow("That isn't a sign-in code.");
        }
        await b.submitCode("claude-code", "  the-pasted-code  ");
        await states.until((s) => s.at(-1)?.["claude-code"].phase === "ready", "Claude to be signed in");
        expect(host.writes).toEqual([{ id: loginProcessId("claude-code"), data: "the-pasted-code\n" }]);
        expect(JSON.stringify(states.items)).not.toContain("the-pasted-code");
        expect(b.snapshot()["claude-code"]).toMatchObject({ signedIn: true, account: "user@example.com" });
    }, SLOW);

    test("Codex's device sign-in shows its one-time code from the captured output", async () => {
        const { b, states } = await brains({ installed: ["codex"] });
        await b.signIn("codex", "code");
        await states.until((s) => !!s.at(-1)?.codex.login, "Codex's device code");
        expect(b.snapshot().codex.login).toEqual({ url: "https://auth.openai.com/codex/device", code: "RJEL-90J2I", expectsCode: false, callback: null });
        await expect(b.submitCode("codex", "RJEL-90J2I")).rejects.toThrow("Codex isn't waiting for a code.");
        await b.cancelSignIn("codex");
        expect(b.snapshot().codex).toMatchObject({ phase: "installed", login: null, error: null });
    }, SLOW);
});

// Failures are shown, not swallowed (brains, models and the service).
describe("brain failures", () => {
    test("a status that can't be read is failed, never signed out", async () => {
        const root = tempDir("status");
        cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
        plan(root, { status: { exit: 2, stderr: "panic: config.toml is corrupt\n" } });
        const host = new TestHost(fakeEnv(root));
        cleanups.push(() => host.close());
        const b = new Brains({ host: { ...host, packages: packageHost({ codex: brainPackage(root, "codex") }) } as never, dir: path.join(root, "brains"), onState: () => {} });
        await b.init();
        expect(b.snapshot().codex).toMatchObject({ phase: "failed", installed: true, signedIn: false });
        expect(b.snapshot().codex.error).toContain("panic: config.toml is corrupt");
    }, SLOW);

    test("a model listing that fails or is empty is an error, and a freshly signed-in Claude still lists its models", async () => {
        const { root, host, b } = await brains({ installed: ["codex", "claude-code"] });
        const run = (_c: string, args: string[], o: { timeoutMs: number }) => host.exec(b.resolve("codex")!, args, { timeoutMs: o.timeoutMs, env: b.env("codex") });
        const claude = () => askClaudeModels(host, { command: b.resolve("claude-code")!, env: b.env("claude-code"), cwd: path.join(root, "models") });
        plan(root, { models: { exit: 1, stderr: "not signed in" } });
        await expect(listModels("codex", b.homes, run, claude)).rejects.toThrow("Codex couldn't list its models: not signed in");
        plan(root, { models: { stdout: '{"models":[]}' } });
        await expect(listModels("codex", b.homes, run, claude)).rejects.toThrow("Codex's model list is empty.");
        plan(root, { models: { stdout: '{"models":[{"slug":"gpt-x","display_name":"GPT X","visibility":"list","priority":1}]}' } });
        expect(await listModels("codex", b.homes, run, claude)).toEqual([{ id: "gpt-x", name: "GPT X", description: null, older: false }]);

        // no catalog yet: Claude itself is asked, over stream-json
        expect(fs.existsSync(path.join(b.homes.claude, "cache", "model-catalog"))).toBe(false);
        plan(root, { claudeModels: [] });
        await expect(listModels("claude-code", b.homes, run, claude)).rejects.toThrow("Claude's model list is empty.");
        plan(root, {
            claudeModels: [
                { value: "default", resolvedModel: "claude-default", displayName: "Default" },
                { value: "opus", resolvedModel: "claude-opus-5-5", description: "Opus 5.5 · Most capable" },
            ],
        });
        expect(await listModels("claude-code", b.homes, run, claude)).toEqual([{ id: "claude-opus-5-5", name: "Opus 5.5", description: "Most capable", older: false }]);
        // each Claude it asked was stopped once it answered: nothing reached a model
        const asked = host.started.filter((s) => s.id.includes(".models."));
        expect(asked).toHaveLength(2);
        for (const s of asked) await host.gone(s.id);
        expect(host.kills.filter((k) => k.id.includes(".models.")).map((k) => k.signal)).toEqual(["SIGTERM", "SIGTERM"]);
    }, SLOW);

    test("a service whose init throws rejects ready(), so its actions fail instead of hanging", async () => {
        const app = new AiApp({ storageDir: async () => Promise.reject(new Error("the panel's storage is gone")) } as unknown as AppHost);
        const ctx = { state: {} as never, setState: () => {}, emit: () => {}, trigger: () => {} };
        await expect(app.init(ctx)).rejects.toThrow("the panel's storage is gone");
        await expect(app.ready()).rejects.toThrow("the Agent service didn't start: the panel's storage is gone");
        const send = app.flowActions().find((a) => a.id === "send-message")!;
        await expect(Promise.resolve(send.run!({} as never, { text: "hi" }))).rejects.toThrow("the Agent service didn't start");
    });
});
