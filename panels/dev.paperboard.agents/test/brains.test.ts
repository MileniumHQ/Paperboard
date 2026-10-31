import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_STATE, type BrainState, type Harness } from "../src/contract";
import { Brains, loginProcessId, type BrainsHost } from "../src/service/brains";
import { FakeProcesses, until } from "./fakeHost";

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const PROGRAM: Record<Harness, string> = { codex: "codex", "claude-code": "claude", opencode: "opencode" };

let dir = "";
afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = "";
});

interface Setup {
    /** the brains that are installed as packages when the service starts */
    installed?: Harness[];
    /** who the status commands say is signed in */
    signedIn?: Harness[];
    platform?: NodeJS.Platform;
    arch?: string;
    pageMs?: number;
    /** the install's download: what it does (by default it unpacks the program) */
    download?: (name: string, onProgress?: (p: { stage: string; percent: number }) => void) => Promise<void>;
}

function setup(o: Setup = {}) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-brains-"));
    const procs = new FakeProcesses();
    const installed = new Set<string>();
    const signedIn = new Set<Harness>(o.signedIn ?? []);
    const commands: { command: string; args: string[]; env?: Record<string, string> }[] = [];
    const pkgOf = (h: Harness) => (h === "claude-code" ? "claude-code" : h);
    const plant = (h: Harness) => {
        const bin = path.join(dir, "packages", pkgOf(h), "bin");
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, PROGRAM[h] + (o.platform === "win32" ? ".exe" : "")), "#!/bin/sh\n", { mode: 0o755 });
        installed.add(pkgOf(h));
    };
    for (const h of o.installed ?? []) plant(h);
    const harnessOf = (command: string): Harness => (command.includes("/claude-code/") ? "claude-code" : command.includes("/codex/") ? "codex" : "opencode");
    const host: BrainsHost = {
        start: procs.start,
        write: procs.write,
        kill: procs.kill,
        exists: procs.exists,
        onStdout: procs.onStdout,
        onStderr: procs.onStderr,
        onExit: procs.onExit,
        exec: async (command, args, opts) => {
            commands.push({ command, args, env: opts?.env });
            const h = harnessOf(command);
            if (args.join(" ") === "login status") return signedIn.has(h) ? { stdout: "Logged in using ChatGPT", stderr: "", exitCode: 0 } : { stdout: "Not logged in", stderr: "", exitCode: 1 };
            if (args.join(" ") === "auth status") return { stdout: JSON.stringify({ loggedIn: signedIn.has(h) }), stderr: "", exitCode: signedIn.has(h) ? 0 : 1 };
            if (args[0] === "auth" && args[1] === "list") return { stdout: JSON.stringify(signedIn.has(h) ? [{ id: "openrouter", name: "OpenRouter", connections: [{ id: "c1" }] }] : []), stderr: "", exitCode: 0 };
            if (args.join(" ") === "logout" || args.join(" ") === "auth logout") {
                signedIn.delete(h);
                return { stdout: "", stderr: "", exitCode: 0 };
            }
            throw new Error(`unexpected command ${args.join(" ")}`);
        },
        packages: {
            isInstalled: async (name) => installed.has(name),
            download: async (name, onProgress) => {
                if (o.download) await o.download(name, onProgress);
                else {
                    onProgress?.({ stage: "downloading", percent: 40 });
                    plant(name as Harness);
                }
            },
            getPath: async (name) => path.join(dir, "packages", name),
            version: async () => "9.9.9",
            updateWaiting: async () => false,
        },
    };
    const states: Record<Harness, BrainState>[] = [];
    const brains = new Brains({ host, dir: path.join(dir, "brains"), onState: (s) => states.push(s), platform: o.platform, arch: o.arch, pageMs: o.pageMs ?? 2000, loginMs: 5000 });
    return { brains, procs, signedIn, commands, states, last: () => states.at(-1) ?? DEFAULT_STATE.brains };
}

describe("looking at the brains", () => {
    test("nothing installed is 'none'; an installed one shows its version and whether it's signed in", async () => {
        const s = setup({ installed: ["codex", "claude-code", "opencode"], signedIn: ["claude-code"] });
        await s.brains.init();
        const b = s.brains.snapshot();
        expect(b.codex).toMatchObject({ phase: "installed", installed: true, signedIn: false, version: "9.9.9" });
        expect(b["claude-code"]).toMatchObject({ phase: "ready", signedIn: true });
        // OpenCode has free models: nothing to sign in to
        expect(b.opencode).toMatchObject({ phase: "ready", signedIn: false });
        expect(setup().brains.resolve("codex")).toBeNull();
    });

    test("a brain runs from its package with a home of its own and no updating itself", async () => {
        const s = setup({ installed: ["codex", "claude-code", "opencode"] });
        await s.brains.init();
        const home = (n: string) => path.join(dir, "brains", n);
        expect(s.brains.resolve("codex")).toBe(path.join(dir, "packages", "codex", "bin", "codex"));
        expect(s.brains.env("codex")).toEqual({ CODEX_HOME: home("codex") });
        expect(s.brains.env("claude-code")).toEqual({ CLAUDE_CONFIG_DIR: home("claude"), DISABLE_AUTOUPDATER: "1" });
        expect(s.brains.env("opencode")).toMatchObject({ XDG_DATA_HOME: path.join(home("opencode"), "data"), XDG_CONFIG_HOME: path.join(home("opencode"), "config"), OPENCODE_DISABLE_AUTOUPDATE: "1" });
        expect(s.brains.homes).toEqual({ claude: home("claude"), codex: home("codex") });
        // every look is made in that home
        expect(s.commands.every((c) => c.env && Object.keys(c.env).length > 0)).toBe(true);
        expect(fs.existsSync(home("codex"))).toBe(true);
    });

    test("a status the brain can't give is a failure to show, and the service goes on", async () => {
        const s = setup({ installed: ["codex"] });
        const exec = (s.brains as unknown as { deps: { host: BrainsHost } }).deps.host;
        exec.exec = async () => ({ stdout: "", stderr: "database is locked", exitCode: 2 });
        await s.brains.init();
        expect(s.brains.snapshot().codex).toMatchObject({ phase: "failed", installed: true });
        expect(s.brains.snapshot().codex.error).toContain("database is locked");
    });

    test("a computer with no build is told so, not left waiting", async () => {
        const s = setup({ platform: "freebsd" as NodeJS.Platform });
        await s.brains.init();
        expect(s.brains.snapshot().codex).toMatchObject({ phase: "unsupported" });
        await expect(s.brains.install("codex")).rejects.toThrow("no build for this computer");
    });
});

describe("installing", () => {
    test("shows the download, then looks at what arrived", async () => {
        const s = setup();
        await s.brains.init();
        await s.brains.install("codex");
        expect(s.states.some((st) => st.codex.phase === "installing" && st.codex.percent === 40)).toBe(true);
        expect(s.brains.snapshot().codex).toMatchObject({ phase: "installed", installed: true, percent: null, error: null });
        await s.brains.install("opencode");
        expect(s.brains.snapshot().opencode.phase).toBe("ready");
    });

    test("a download that fails says why, and the brain stays not installed", async () => {
        const s = setup({
            download: async () => {
                throw new Error("Install refused: the checksum doesn't match");
            },
        });
        await s.brains.init();
        await expect(s.brains.install("codex")).rejects.toThrow("checksum");
        expect(s.brains.snapshot().codex).toMatchObject({ phase: "failed", installed: false });
        expect(s.brains.snapshot().codex.error).toContain("Codex didn't install: Install refused: the checksum doesn't match");
    });

    test("a package with no program in it is an error", async () => {
        const s = setup({
            download: async (name) => {
                fs.mkdirSync(path.join(dir, "packages", name, "bin"), { recursive: true });
                (s.brains as unknown as { deps: { host: BrainsHost } }).deps.host.packages.isInstalled = async () => true;
            },
        });
        await s.brains.init();
        await expect(s.brains.install("codex")).rejects.toThrow("has no program in it");
    });
});

describe("signing in", () => {
    test("Codex: the page is shown as it's printed, and finishing signs it in", async () => {
        const s = setup({ installed: ["codex"] });
        await s.brains.init();
        await s.brains.signIn("codex");
        const id = loginProcessId("codex");
        const started = s.procs.started.find((p) => p.id === id)!;
        expect(started.args).toEqual(["login"]);
        expect(started.env).toMatchObject({ CODEX_HOME: path.join(dir, "brains", "codex") });
        // no terminal input for a login that needs none
        expect(started.stdin).toBe(false);
        expect(s.brains.snapshot().codex).toMatchObject({ phase: "signing-in", login: null });

        s.procs.stdout(id, fixture("codexLogin.txt"));
        await until(() => s.brains.snapshot().codex.login !== null);
        expect(s.brains.snapshot().codex.login?.url).toStartWith("https://auth.openai.com/oauth/authorize");

        s.signedIn.add("codex");
        s.procs.exit(id, 0);
        await until(() => s.brains.snapshot().codex.phase === "ready");
        expect(s.brains.snapshot().codex).toMatchObject({ signedIn: true, login: null, error: null });
    });

    test("Codex by code: the page and the code appear together", async () => {
        const s = setup({ installed: ["codex"] });
        await s.brains.init();
        await s.brains.signIn("codex", "code");
        const id = loginProcessId("codex");
        expect(s.procs.started.find((p) => p.id === id)!.args).toEqual(["login", "--device-auth"]);
        s.procs.stdout(id, "Follow these steps\n   https://auth.openai.com/codex/device\n");
        await new Promise((r) => setTimeout(r, 20));
        expect(s.brains.snapshot().codex.login).toBeNull();
        s.procs.stdout(id, "2. Enter this one-time code\n   RJEL-90J2I\n");
        await until(() => s.brains.snapshot().codex.login?.code === "RJEL-90J2I");
        s.procs.exit(id, 1);
        await until(() => s.brains.snapshot().codex.phase === "failed");
    });

    test("Claude: the code the page shows goes to the login's input, once, and is kept nowhere", async () => {
        const s = setup({ installed: ["claude-code"] });
        await s.brains.init();
        await expect(s.brains.submitCode("claude-code", "abc")).rejects.toThrow("isn't waiting for a code");
        await s.brains.signIn("claude-code");
        const id = loginProcessId("claude-code");
        const started = s.procs.started.find((p) => p.id === id)!;
        expect(started.args).toEqual(["auth", "login", "--claudeai"]);
        expect(started.stdin).toBeUndefined();
        s.procs.stdout(id, fixture("claudeLogin.txt"));
        await until(() => s.brains.snapshot()["claude-code"].login?.expectsCode === true);

        await expect(s.brains.submitCode("claude-code", "")).rejects.toThrow("isn't a sign-in code");
        await expect(s.brains.submitCode("claude-code", "abc\nrm -rf")).rejects.toThrow("isn't a sign-in code");
        await expect(s.brains.submitCode("claude-code", 42)).rejects.toThrow("isn't a sign-in code");
        await s.brains.submitCode("claude-code", "  the-code#state  ");
        expect(s.procs.written).toEqual([{ id, data: "the-code#state\n" }]);
        expect(JSON.stringify(s.states)).not.toContain("the-code");
    });

    test("a sign-in that ends badly says what the harness printed", async () => {
        const s = setup({ installed: ["codex"] });
        await s.brains.init();
        await s.brains.signIn("codex");
        const id = loginProcessId("codex");
        s.procs.stderr(id, "Error: port 1455 is already in use\n");
        s.procs.exit(id, 1);
        await until(() => s.brains.snapshot().codex.phase === "failed");
        expect(s.brains.snapshot().codex.error).toBe("The Codex sign-in ended (exit 1): Error: port 1455 is already in use");
    });

    test("a sign-in that ends well but leaves it signed out is a failure, not a success", async () => {
        const s = setup({ installed: ["codex"] });
        await s.brains.init();
        await s.brains.signIn("codex");
        s.procs.exit(loginProcessId("codex"), 0);
        await until(() => s.brains.snapshot().codex.phase === "failed");
        expect(s.brains.snapshot().codex.error).toContain("still says it isn't signed in");
    });

    test("no page in time is stopped, and carries what was printed", async () => {
        const s = setup({ installed: ["claude-code"], pageMs: 40 });
        await s.brains.init();
        await s.brains.signIn("claude-code");
        const id = loginProcessId("claude-code");
        s.procs.stdout(id, "Opening browser to sign in…\n");
        await until(() => s.brains.snapshot()["claude-code"].phase === "failed");
        expect(s.procs.killed.map((k) => k.id)).toEqual([id]);
        expect(s.brains.snapshot()["claude-code"].error).toBe("Claude didn't show a sign-in page: Opening browser to sign in…");
    });

    test("stopping a sign-in puts the brain back as it was, with no error", async () => {
        const s = setup({ installed: ["codex"] });
        await s.brains.init();
        await s.brains.signIn("codex");
        await s.brains.cancelSignIn("codex");
        expect(s.procs.killed.map((k) => k.id)).toEqual([loginProcessId("codex")]);
        expect(s.brains.snapshot().codex).toMatchObject({ phase: "installed", error: null, login: null });
        // and it can be started again
        await s.brains.signIn("codex");
        expect(s.brains.snapshot().codex.phase).toBe("signing-in");
    });

    test("signing in to what isn't installed, or to OpenCode, is refused", async () => {
        const s = setup({ installed: ["opencode"] });
        await s.brains.init();
        await expect(s.brains.signIn("codex")).rejects.toThrow("isn't installed yet");
        expect(() => s.brains.signIn("opencode")).toThrow("connects providers");
        expect(s.procs.started).toEqual([]);
    });
});

describe("signing out", () => {
    test("runs the harness's own logout, then looks again", async () => {
        const s = setup({ installed: ["claude-code"], signedIn: ["claude-code"] });
        await s.brains.init();
        await s.brains.signOut("claude-code");
        expect(s.commands.some((c) => c.args.join(" ") === "auth logout")).toBe(true);
        expect(s.brains.snapshot()["claude-code"]).toMatchObject({ phase: "installed", signedIn: false });
    });
});
