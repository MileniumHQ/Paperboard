import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { callbackAddress, loginCommand, loopbackCallback, outputTail, readLoginOutput, readStatus, stripAnsi } from "../src/service/brainLogin";

// what the harnesses really printed when a login was started with no terminal (Codex 0.166, Claude Code 2.1.316)
const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("the address a browser comes back to", () => {
    test("only a loopback http address with a port is a callback", () => {
        const page = (redirect: string) => `https://example.com/authorize?redirect_uri=${encodeURIComponent(redirect)}&state=s`;
        expect(loopbackCallback(page("http://localhost:1455/auth/callback?x=1"))).toBe("http://localhost:1455/auth/callback");
        expect(loopbackCallback(page("http://[::1]:8085/cb"))).toBe("http://[::1]:8085/cb");
        expect(loopbackCallback(page("https://platform.claude.com/oauth/code/callback"))).toBeNull();
        expect(loopbackCallback(page("http://evil.example:1455/auth/callback"))).toBeNull();
        expect(loopbackCallback(page("http://127.0.0.1/auth/callback"))).toBeNull();
        expect(loopbackCallback("https://example.com/authorize")).toBeNull();
    });

    test("a pasted address must be that callback, with the page's answer in it", () => {
        const callback = "http://127.0.0.1:1455/auth/callback";
        expect(callbackAddress(callback, "  http://localhost:1455/auth/callback?code=c&state=s \n").href).toBe("http://localhost:1455/auth/callback?code=c&state=s");
        expect(() => callbackAddress(callback, "http://127.0.0.1:1456/auth/callback?code=c")).toThrow("It starts with http://127.0.0.1:1455/auth/callback");
        expect(() => callbackAddress(callback, "http://127.0.0.1:1455/other?code=c")).toThrow("isn't the address");
        expect(() => callbackAddress(callback, "http://192.168.1.2:1455/auth/callback?code=c")).toThrow("isn't the address");
        expect(() => callbackAddress(callback, "https://127.0.0.1:1455/auth/callback?code=c")).toThrow("isn't the address");
        expect(() => callbackAddress(callback, "code=c&state=s")).toThrow("isn't the address");
        expect(() => callbackAddress(callback, "http://127.0.0.1:1455/auth/callback")).toThrow("no sign-in answer");
        expect(() => callbackAddress(callback, 42)).toThrow("isn't the address");
    });
});

describe("reading what a login prints", () => {
    test("Codex's browser login: the page, not the local server it mentions first", () => {
        const prompt = readLoginOutput("codex", "browser", fixture("codexLogin.txt"));
        expect(prompt?.url).toStartWith("https://auth.openai.com/oauth/authorize?");
        expect(prompt).toMatchObject({ code: null, expectsCode: false });
        // the browser comes back to the login's own listener, on the brain's computer
        expect(prompt?.callback).toBe("http://127.0.0.1:1455/auth/callback");
    });

    test("Codex's device login: the page and its code, through the colours", () => {
        const text = fixture("codexDeviceAuth.txt");
        expect(text).toContain("\u001b[");
        expect(readLoginOutput("codex", "code", text)).toEqual({ url: "https://auth.openai.com/codex/device", code: "RJEL-90J2I", expectsCode: false, callback: null });
    });

    test("the device page alone isn't shown: the user would have nothing to type there", () => {
        expect(readLoginOutput("codex", "code", "1. Open this link\n   https://auth.openai.com/codex/device\n")).toBeNull();
    });

    test("Claude's login: the page it falls back to, whose end is a code to paste back", () => {
        const prompt = readLoginOutput("claude-code", "browser", fixture("claudeLogin.txt"));
        expect(prompt?.url).toStartWith("https://claude.com/cai/oauth/authorize?");
        expect(prompt?.url).toContain("platform.claude.com%2Foauth%2Fcode%2Fcallback");
        expect(prompt).toMatchObject({ code: null, expectsCode: true, callback: null });
    });

    test("nothing to show until a page is printed", () => {
        expect(readLoginOutput("codex", "browser", "Starting local login server on http://localhost:1455.\n")).toBeNull();
        expect(readLoginOutput("claude-code", "browser", "Opening browser to sign in…\n")).toBeNull();
    });

    test("each harness is signed in by its own command", () => {
        expect(loginCommand("codex", "browser")).toEqual({ args: ["login"], needsInput: false });
        expect(loginCommand("codex", "code")).toEqual({ args: ["login", "--device-auth"], needsInput: false });
        expect(loginCommand("claude-code", "browser")).toEqual({ args: ["auth", "login", "--claudeai"], needsInput: true });
    });
});

describe("reading who is signed in", () => {
    const out = (stdout: string, exitCode: number, stderr = "") => ({ stdout, stderr, exitCode });

    test("Claude's JSON, signed in or not", () => {
        expect(readStatus("claude-code", out('{"loggedIn":true,"authMethod":"claude.ai","email":"pip@example.com"}', 0))).toEqual({ signedIn: true, account: "pip@example.com" });
        expect(readStatus("claude-code", out('{"loggedIn":true,"authMethod":"claude.ai"}', 0))).toEqual({ signedIn: true, account: "claude.ai" });
        // what 2.1.316 prints with no login: exit 1 and the answer
        expect(readStatus("claude-code", out('{"loggedIn":false,"authMethod":"none"}', 1))).toEqual({ signedIn: false, account: null });
    });

    test("an answer from Claude that isn't one is an error, never 'signed out'", () => {
        expect(() => readStatus("claude-code", out("", 1, "boom"))).toThrow("boom");
        expect(() => readStatus("claude-code", out("{}", 0))).toThrow("didn't say");
    });

    test("Codex: exit 0 is signed in, 'Not logged in' with exit 1 is signed out, anything else is an error", () => {
        expect(readStatus("codex", out("Logged in using ChatGPT", 0))).toEqual({ signedIn: true, account: "ChatGPT" });
        expect(readStatus("codex", out("Not logged in", 1))).toEqual({ signedIn: false, account: null });
        expect(() => readStatus("codex", out("", 2, "database is locked"))).toThrow("database is locked");
    });

    test("the tail of output is plain text for an error message", () => {
        expect(stripAnsi("\u001b[94mhello\u001b[0m")).toBe("hello");
        expect(outputTail("a\n\n b \nc\nd\ne\n", 3)).toBe("c | d | e");
    });
});
