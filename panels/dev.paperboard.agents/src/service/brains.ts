// The agent's brains: Codex, Claude Code and OpenCode, each a package the
// daemon installs from its vendor's own release (Origami pins the version and
// checksum; the daemon verifies and unpacks it). The panel doesn't look for
// them on the computer: it installs them, runs them from the package, and
// signs them in with their own login commands.
//
// Each harness runs with its home inside this panel's storage (CODEX_HOME,
// CLAUDE_CONFIG_DIR, XDG_* for OpenCode), so the agent never touches, or is
// changed by, the user's own installs and settings. Credentials stay in those
// folders, written by the harnesses themselves; this panel never reads them.
// Auto-update is off for every harness: the package is the only way a new
// build arrives.

import fs from "node:fs";
import path from "node:path";
import { SIGN_IN_REQUIRED, type BrainState, type Harness, type LoginPrompt } from "../contract";
import { errorText } from "../lib/failure";
import { LOGOUT_COMMAND, STATUS_COMMAND, loginCommand, outputTail, readLoginOutput, readStatus, type LoginMethod } from "./brainLogin";
import type { PackageHost, StartOptions } from "./browser";

export const BRAIN_PACKAGES: Record<Harness, string> = { codex: "codex", "claude-code": "claude-code", opencode: "opencode" };
const PROGRAMS: Record<Harness, string> = { codex: "codex", "claude-code": "claude", opencode: "opencode" };
const NAMES: Record<Harness, string> = { codex: "Codex", "claude-code": "Claude", opencode: "OpenCode" };

/** the daemon's packages, plus what the brains need to know about them */
export interface BrainPackages extends PackageHost {
    /** the installed version, null when it isn't installed */
    version(name: string): Promise<string | null>;
    /** a newer build is downloaded and waits for the programs running from this one to stop */
    updateWaiting(name: string): Promise<boolean>;
}

export interface BrainsHost {
    start(o: StartOptions): Promise<unknown>;
    write(id: string, data: string): Promise<void>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onStdout(id: string, cb: (data: string) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    onExit(id: string, cb: (code?: number) => void): () => void;
    exec(command: string, args: string[], o?: { timeoutMs?: number; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    packages: BrainPackages;
}

export interface BrainsDeps {
    host: BrainsHost;
    /** the brains' folder in the panel's storage; each harness's home is inside it */
    dir: string;
    onState: (brains: Record<Harness, BrainState>) => void;
    platform?: NodeJS.Platform;
    arch?: string;
    /** how long a sign-in may take to show its page / to be finished */
    pageMs?: number;
    loginMs?: number;
    statusMs?: number;
}

const PAGE_MS = 30_000;
/** Codex's device codes live 15 minutes; a browser sign-in gets the same */
const LOGIN_MS = 15 * 60_000;
const STATUS_MS = 30_000;
const OUTPUT_CAP = 20_000;
const CODE_MAX = 2_000;

export const loginProcessId = (harness: Harness) => `brain-login-${harness}`;

const none = (): BrainState => ({ phase: "none", installed: false, version: null, signedIn: false, account: null, percent: null, login: null, error: null, updateWaiting: false });

interface Login {
    cancelled: boolean;
    failure: string | null;
    exited: Promise<number | undefined>;
}

export class Brains {
    private state: Record<Harness, BrainState> = { codex: none(), "claude-code": none(), opencode: none() };
    private dirs: Partial<Record<Harness, string>> = {};
    private busy: Record<Harness, Promise<unknown>> = { codex: Promise.resolve(), "claude-code": Promise.resolve(), opencode: Promise.resolve() };
    private logins = new Map<Harness, Login>();

    constructor(private deps: BrainsDeps) {}

    private get platform() {
        return this.deps.platform ?? process.platform;
    }

    private get supported() {
        const arch = this.deps.arch ?? process.arch;
        return ["linux", "darwin", "win32"].includes(this.platform) && ["x64", "arm64"].includes(arch);
    }

    /** a harness's home: its credentials, settings and caches. Only this panel uses it. */
    home(harness: Harness): string {
        return path.join(this.deps.dir, harness === "claude-code" ? "claude" : harness);
    }

    /** where Claude's and Codex's own files are, for their model catalogs and thread sizes */
    get homes() {
        return { claude: this.home("claude-code"), codex: this.home("codex") };
    }

    /** What a harness runs with besides the daemon's environment: its home, and no updating itself. */
    env(harness: Harness): Record<string, string> {
        const home = this.home(harness);
        if (harness === "codex") return { CODEX_HOME: home };
        if (harness === "claude-code") return { CLAUDE_CONFIG_DIR: home, DISABLE_AUTOUPDATER: "1" };
        return {
            XDG_DATA_HOME: path.join(home, "data"),
            XDG_CONFIG_HOME: path.join(home, "config"),
            XDG_CACHE_HOME: path.join(home, "cache"),
            XDG_STATE_HOME: path.join(home, "state"),
            OPENCODE_DISABLE_AUTOUPDATE: "1",
        };
    }

    snapshot(): Record<Harness, BrainState> {
        return structuredClone(this.state);
    }

    /** The harness's program, or null while its package isn't installed. */
    resolve(harness: Harness): string | null {
        const dir = this.dirs[harness];
        if (!dir) return null;
        const exe = path.join(dir, "bin", PROGRAMS[harness] + (this.platform === "win32" ? ".exe" : ""));
        return fs.statSync(exe, { throwIfNoEntry: false })?.isFile() ? exe : null;
    }

    /** Look at every brain once, when the service starts. A brain that can't be looked at shows why. */
    async init(): Promise<void> {
        for (const h of Object.keys(this.state) as Harness[]) fs.mkdirSync(this.home(h), { recursive: true });
        // a look that fails is in the brain's state; one brain's trouble doesn't stop the service
        await Promise.all(
            (Object.keys(this.state) as Harness[]).map((h) =>
                this.exclusive(h, () => this.look(h)).catch((e) => console.error(`[ai] couldn't look at ${NAMES[h]}: ${errorText(e)}`)),
            ),
        );
    }

    install(harness: Harness): Promise<void> {
        return this.exclusive(harness, async () => {
            if (!this.supported) throw this.fail(harness, `${NAMES[harness]} has no build for this computer (${this.platform}, ${this.deps.arch ?? process.arch}).`, "unsupported");
            this.set(harness, { phase: "installing", percent: 0, error: null });
            try {
                await this.deps.host.packages.download(BRAIN_PACKAGES[harness], (p) => {
                    if (p.stage === "downloading") this.set(harness, { percent: Math.round(p.percent) });
                });
            } catch (e) {
                // a failed update leaves the build that was there; a failed first install leaves nothing
                await this.look(harness, `${NAMES[harness]} didn't install: ${errorText(e)}`);
                throw e;
            }
            await this.look(harness);
        });
    }

    /** Start the harness's own sign-in. Resolves when it has started; how it ends shows in the state. */
    signIn(harness: Harness, method: LoginMethod = "browser"): Promise<void> {
        if (harness === "opencode") throw new Error("OpenCode connects providers, not an account");
        return this.exclusive(harness, async () => {
            const exe = this.resolve(harness);
            if (!exe) throw this.fail(harness, `${NAMES[harness]} isn't installed yet.`);
            await this.cancel(harness);
            const { args, needsInput } = loginCommand(harness, method);
            const id = loginProcessId(harness);
            let out = "";
            const login: Login = { cancelled: false, failure: null, exited: undefined as never };
            const shown = (text: string) => {
                out = (out + text).slice(-OUTPUT_CAP);
                const prompt = readLoginOutput(harness, method, out);
                if (prompt && !samePrompt(prompt, this.state[harness].login)) this.set(harness, { login: prompt });
            };
            const offs = [this.deps.host.onStdout(id, shown), this.deps.host.onStderr(id, shown)];
            login.exited = new Promise<number | undefined>((ok) => {
                offs.push(
                    this.deps.host.onExit(id, (code) => {
                        for (const off of offs) off();
                        ok(code);
                    }),
                );
            });
            this.logins.set(harness, login);
            this.set(harness, { phase: "signing-in", login: null, error: null });
            try {
                await this.deps.host.start({ id, command: exe, args, cwd: this.home(harness), env: this.env(harness), ...(needsInput ? {} : { stdin: false }) });
            } catch (e) {
                for (const off of offs) off();
                this.logins.delete(harness);
                throw this.fail(harness, `${NAMES[harness]}'s sign-in didn't start: ${errorText(e)}`);
            }
            void this.finishLogin(harness, login, () => out);
        });
    }

    /** The code the sign-in page showed, for the harness that asks for it. It goes to the harness and is kept nowhere. */
    async submitCode(harness: Harness, code: unknown): Promise<void> {
        const prompt = this.state[harness].login;
        if (!this.logins.has(harness) || !prompt?.expectsCode) throw new Error(`${NAMES[harness]} isn't waiting for a code.`);
        if (typeof code !== "string" || !code.trim() || code.trim().length > CODE_MAX || /[\r\n]/.test(code.trim())) throw new Error("That isn't a sign-in code.");
        await this.deps.host.write(loginProcessId(harness), `${code.trim()}\n`);
    }

    /** Stop a sign-in the user gave up on: back to where it started, with no error. */
    cancelSignIn(harness: Harness): Promise<void> {
        return this.exclusive(harness, async () => {
            await this.cancel(harness);
            await this.look(harness);
        });
    }

    signOut(harness: Harness): Promise<void> {
        if (harness === "opencode") throw new Error("OpenCode's providers are disconnected one by one");
        return this.exclusive(harness, async () => {
            const exe = this.resolve(harness);
            if (!exe) throw this.fail(harness, `${NAMES[harness]} isn't installed.`);
            const out = await this.deps.host.exec(exe, LOGOUT_COMMAND[harness], { timeoutMs: this.deps.statusMs ?? STATUS_MS, env: this.env(harness) });
            if (out.exitCode !== 0) throw this.fail(harness, `${NAMES[harness]} didn't sign out: ${outputTail(out.stderr || out.stdout) || `exit ${out.exitCode}`}`);
            await this.look(harness);
        });
    }

    /** Look at a harness again (after providers changed, say). */
    refresh(harness: Harness): Promise<void> {
        return this.exclusive(harness, () => this.look(harness));
    }

    async shutdown(): Promise<void> {
        await Promise.all([...this.logins.keys()].map((h) => this.cancel(h)));
    }

    // ------------------------------------------------------------- internals

    private exclusive<T>(harness: Harness, fn: () => Promise<T>): Promise<T> {
        const run = this.busy[harness].then(fn, fn);
        this.busy[harness] = run.catch(() => undefined);
        return run;
    }

    private set(harness: Harness, patch: Partial<BrainState>) {
        this.state = { ...this.state, [harness]: { ...this.state[harness], ...patch } };
        this.deps.onState(this.snapshot());
    }

    /** A failure the person is shown: it's the brain's error, and the same Error goes to whoever asked. */
    private fail(harness: Harness, message: string, phase: BrainState["phase"] = "failed"): Error {
        this.set(harness, { phase, error: message, percent: null, login: null, installed: this.resolve(harness) !== null });
        return new Error(message);
    }

    /** What is installed and whether it's signed in. `error` is why a look follows a failure, shown with what was found. */
    private async look(harness: Harness, error: string | null = null): Promise<void> {
        const name = BRAIN_PACKAGES[harness];
        const { host } = this.deps;
        try {
            if (!this.supported) {
                this.set(harness, { ...none(), phase: "unsupported", error: error ?? `${NAMES[harness]} has no build for this computer.` });
                return;
            }
            if (!(await host.packages.isInstalled(name))) {
                delete this.dirs[harness];
                this.set(harness, { ...none(), phase: error ? "failed" : "none", error });
                return;
            }
            this.dirs[harness] = await host.packages.getPath(name);
            if (!this.resolve(harness)) throw new Error(`The ${NAMES[harness]} package has no program in it.`);
            const [version, updateWaiting] = await Promise.all([host.packages.version(name), host.packages.updateWaiting(name)]);
            const { signedIn, account } = await this.status(harness);
            const ready = signedIn || !SIGN_IN_REQUIRED[harness];
            this.set(harness, { phase: error ? "failed" : ready ? "ready" : "installed", installed: true, version, signedIn, account, percent: null, login: null, error, updateWaiting });
        } catch (e) {
            this.set(harness, { phase: "failed", installed: this.resolve(harness) !== null, percent: null, login: null, error: error ?? errorText(e) });
            if (!error) throw e;
        }
    }

    private async status(harness: Harness): Promise<{ signedIn: boolean; account: string | null }> {
        const exe = this.resolve(harness)!;
        const timeoutMs = this.deps.statusMs ?? STATUS_MS;
        if (harness === "opencode") {
            // its free models need no sign-in; this is only whether a provider is connected
            const out = await this.deps.host.exec(exe, ["auth", "list", "--format", "json", "--standalone"], { timeoutMs, env: this.env(harness) });
            if (out.exitCode !== 0) throw new Error(`OpenCode couldn't list its providers: ${outputTail(out.stderr || out.stdout) || `exit ${out.exitCode}`}`);
            let list: { id?: unknown; name?: unknown; connections?: unknown }[];
            try {
                list = JSON.parse(out.stdout);
            } catch {
                throw new Error(`OpenCode's provider list couldn't be read: ${outputTail(out.stdout)}`);
            }
            if (!Array.isArray(list)) throw new Error("OpenCode's provider list isn't a list");
            const connected = list.filter((i) => Array.isArray(i.connections) && i.connections.length > 0).map((i) => String(i.name ?? i.id));
            return { signedIn: connected.length > 0, account: connected.length ? connected.join(", ") : null };
        }
        return readStatus(harness, await this.deps.host.exec(exe, STATUS_COMMAND[harness], { timeoutMs, env: this.env(harness) }));
    }

    /** Wait for the sign-in to end and say how it went. */
    private async finishLogin(harness: Harness, login: Login, output: () => string) {
        const timers = [
            setTimeout(() => {
                if (!this.state[harness].login) this.stop(harness, login, `${NAMES[harness]} didn't show a sign-in page${tail(output())}`);
            }, this.deps.pageMs ?? PAGE_MS),
            setTimeout(() => this.stop(harness, login, `The ${NAMES[harness]} sign-in wasn't finished in time`), this.deps.loginMs ?? LOGIN_MS),
        ];
        const code = await login.exited;
        for (const t of timers) clearTimeout(t);
        if (this.logins.get(harness) === login) this.logins.delete(harness);
        try {
            if (login.cancelled) return;
            if (login.failure) throw new Error(login.failure);
            if (code !== 0) throw new Error(`The ${NAMES[harness]} sign-in ended (exit ${code ?? "?"})${tail(output())}`);
            await this.exclusive(harness, () => this.look(harness));
            if (!this.state[harness].signedIn) throw new Error(`The ${NAMES[harness]} sign-in finished, but ${NAMES[harness]} still says it isn't signed in.`);
        } catch (e) {
            this.fail(harness, errorText(e));
            console.error("[ai]", errorText(e));
        }
    }

    private stop(harness: Harness, login: Login, failure: string) {
        login.failure ??= failure;
        this.deps.host.kill(loginProcessId(harness), "SIGTERM").catch((e) => console.error(`[ai] couldn't stop the ${NAMES[harness]} sign-in: ${errorText(e)}`));
    }

    private async cancel(harness: Harness) {
        const login = this.logins.get(harness);
        if (!login) return;
        login.cancelled = true;
        await this.deps.host.kill(loginProcessId(harness), "SIGTERM");
        await login.exited;
    }
}

const tail = (output: string) => {
    const t = outputTail(output);
    return t ? `: ${t}` : ".";
};

const samePrompt = (a: LoginPrompt, b: LoginPrompt | null) => b !== null && a.url === b.url && a.code === b.code && a.expectsCode === b.expectsCode;
