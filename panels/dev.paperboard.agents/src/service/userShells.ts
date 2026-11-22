// Shells on the user's computer. The agent opens one for a task, once it's
// allowed a shell (access.ts), and keeps using it: cd, variables and a
// program waiting for an answer all carry over from one call to the next,
// the way they do for a person at a terminal. Each is a real terminal the
// daemon runs (terminalApi), so programs that ask questions (gh auth login,
// a package manager's "continue?") ask them, and the agent answers.
//
// What the agent reads is the screen, not the raw stream: the output goes
// through a terminal emulator with no display (@xterm/headless), so a
// progress bar is its last state and a menu drawn with cursor moves reads as
// it looks. Paperboard's shell integration marks where each command's output
// starts and ends and how it exited (OSC 133, workloads/shellIntegration.ts):
// a command's output is the lines between its marks, without the prompt.
//
// sudo never gets a password in these shells: anything the agent set up in
// one could catch it. A command that needs sudo is asked for on a card and
// run outside them (sudo.ts).

import xterm from "@xterm/headless";
import type { IMarker, Terminal as Screen } from "@xterm/headless";
import { errorMessage } from "@mileniumhq/paperapi";
import { LIMITS, type UserShellView } from "../contract";
import { loginEnv } from "./brainLogin";
import type { ToolResult } from "./computerMcp";
import { OUTPUT_CHARS } from "./shell";
import { fault } from "./toolsets";

const L = LIMITS.access;
const COLS = 120;
const ROWS = 40;
/** lines a shell's screen keeps; a command's output beyond this is cut from its start */
const SCROLLBACK = 5_000;
/** how long a new shell has to show its first prompt */
const START_MS = 20_000;
/** a call returns this long after the output last changed, so a program waiting for an answer isn't waited out */
const QUIET_MS = 4_000;
const DEFAULT_WAIT_S = 30;
const MAX_WAIT_S = 300;

/** The keys the agent can press, as a terminal sends them. Arrows depend on the program's cursor mode. */
const KEYS: Record<string, string | ((app: boolean) => string)> = {
    enter: "\r",
    tab: "\t",
    escape: "\u001b",
    backspace: "\u007f",
    space: " ",
    up: (app) => (app ? "\u001bOA" : "\u001b[A"),
    down: (app) => (app ? "\u001bOB" : "\u001b[B"),
    right: (app) => (app ? "\u001bOC" : "\u001b[C"),
    left: (app) => (app ? "\u001bOD" : "\u001b[D"),
    "ctrl-c": "\u0003",
    "ctrl-d": "\u0004",
    "ctrl-z": "\u001a",
};
export const SHELL_KEYS = Object.keys(KEYS);

const SUDO_HERE = "sudo is asking for a password, which is never typed in your shells: press ctrl-c, then request_sudo with the command.";

/** The daemon's terminals, as terminalApi has them. */
export interface Terminals {
    create(id: string, o: { cols: number; rows: number; cwd: string; env: Record<string, string> }): Promise<void>;
    write(id: string, data: string): Promise<void>;
    destroy(id: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onData(id: string, cb: (data: string) => void): () => void;
    onForeground(id: string, cb: (name: string) => void): () => void;
    onExit(id: string, cb: (exitCode?: number) => void): () => void;
}

export interface ShellsDeps {
    terminals: Terminals;
    /** the open shells changed (the Access page lists them) */
    changed(): void;
    platform?: NodeJS.Platform;
}

/** what a command left on the screen, and how it ended (null: it hasn't) */
interface Run {
    command: string;
    start: IMarker;
    end: IMarker | null;
    exitCode: number | null;
    /** the lines the agent was shown last, so the next call shows only what changed */
    shown: string[];
}

class Shell {
    readonly screen: Screen;
    /** the shell has shown a prompt and runs nothing */
    idle = false;
    exited: number | null | undefined = undefined;
    program = "";
    run: Run | null = null;
    private waiters = new Set<() => void>();
    readonly offs: (() => void)[] = [];

    constructor(
        readonly n: number,
        readonly id: string,
        readonly task: string,
        readonly folder: string,
        readonly opened: number,
    ) {
        this.screen = new xterm.Terminal({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true });
        this.screen.parser.registerOscHandler(133, (body) => {
            this.mark(body);
            return false; // the rest of the parser may read it too
        });
    }

    private mark(body: string) {
        const kind = body.split(";")[0];
        if (kind === "A") {
            // a prompt: a command that never said it ended (killed by a signal the shell missed) has
            if (this.run && !this.run.end) this.run.end = this.screen.registerMarker(0) ?? null;
            this.idle = true;
        } else if (kind === "C") {
            this.idle = false;
            // the command's line is the agent's (run sets it); one typed into a program's prompt has none
            const start = this.screen.registerMarker(0);
            if (start) this.run = { command: "", start, end: null, exitCode: null, shown: [] };
        } else if (kind === "D" && this.run && !this.run.end) {
            const code = Number.parseInt(body.split(";")[1] ?? "", 10);
            this.run.exitCode = Number.isFinite(code) ? code : 0;
            this.run.end = this.screen.registerMarker(0) ?? null;
        }
    }

    feed(data: string) {
        this.screen.write(data, () => this.wake());
    }

    wake() {
        for (const w of [...this.waiters]) w();
    }

    /** Wait until `done` holds, the output stops changing for QUIET_MS, or `ms` passes. */
    async settle(ms: number, done: () => boolean): Promise<void> {
        const deadline = Date.now() + ms;
        let quietAt = Date.now() + QUIET_MS;
        while (!done() && this.exited === undefined && Date.now() < deadline && Date.now() < quietAt) {
            await new Promise<void>((resolve) => {
                const t = setTimeout(finish, Math.min(deadline, quietAt) - Date.now());
                function finish() {
                    clearTimeout(t);
                    resolve();
                }
                const w = () => {
                    quietAt = Date.now() + QUIET_MS;
                    this.waiters.delete(w);
                    finish();
                };
                this.waiters.add(w);
            });
        }
    }

    /** The screen's lines from `from` to `to` (markers), or to the cursor; empty lines at the end dropped. */
    lines(from: IMarker, to: IMarker | null): { lines: string[]; cut: boolean } {
        const b = this.screen.buffer.active;
        const cut = from.isDisposed;
        const start = cut ? 0 : from.line;
        const end = to && !to.isDisposed ? to.line : b.baseY + b.cursorY + 1;
        const out: string[] = [];
        for (let i = start; i < end; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
        while (out.length && !out.at(-1)!.trim()) out.pop();
        return { lines: out, cut };
    }

    /** the last line the cursor is on, as shown */
    cursorLine(): string {
        const b = this.screen.buffer.active;
        return b.getLine(b.baseY + b.cursorY)?.translateToString(true) ?? "";
    }

    get appCursor(): boolean {
        return this.screen.modes.applicationCursorKeysMode;
    }

    dispose() {
        for (const off of this.offs.splice(0)) off();
        this.screen.dispose();
    }
}

/** text cut to OUTPUT_CHARS: its start and its end, which says how it finished */
function cutText(text: string): string {
    if (text.length <= OUTPUT_CHARS) return text;
    const head = Math.floor(OUTPUT_CHARS / 4);
    const tail = OUTPUT_CHARS - head;
    return `${text.slice(0, head)}\n[… ${text.length - OUTPUT_CHARS} characters cut; narrow it down with head, tail or grep …]\n${text.slice(-tail)}`;
}

const waitSeconds = (raw: unknown): number | string => {
    if (raw === undefined || raw === null) return DEFAULT_WAIT_S;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 && n <= MAX_WAIT_S ? n : `wait_seconds is 1 to ${MAX_WAIT_S}`;
};

export class UserShells {
    private shells = new Map<number, Shell>();

    constructor(private deps: ShellsDeps) {}

    private terminalId(n: number) {
        return `dev.paperboard.agents.shell-${n}`;
    }

    /** Shells left by a service that stopped without closing them (it crashed): they're nobody's now. */
    async sweep(): Promise<void> {
        for (let n = 1; n <= L.shells; n++) {
            const id = this.terminalId(n);
            if (!this.shells.has(n) && (await this.deps.terminals.exists(id))) await this.deps.terminals.destroy(id);
        }
    }

    view(): UserShellView[] {
        return [...this.shells.values()].map((s) => ({
            id: s.n,
            task: s.task,
            folder: s.folder,
            opened: s.opened,
            running: s.idle || !s.run ? null : s.run.command || s.program || "a command",
        }));
    }

    /** the open shells, as the agent's context lists them */
    summary(): string {
        if (!this.shells.size) return "No shells are open.";
        return [...this.shells.values()]
            .map((s) => `- shell ${s.n}, for "${s.task}" (opened in ${s.folder}): ${s.idle || !s.run ? "at its prompt" : `running \`${s.run.command || s.program}\``}`)
            .join("\n");
    }

    private shell(raw: unknown): Shell {
        const n = Number(raw);
        const s = this.shells.get(n);
        if (!s) throw new Error(this.shells.size ? `there's no shell ${String(raw)}; open ones: ${[...this.shells.keys()].join(", ")}` : "no shell is open; open one with user_shell_open");
        return s;
    }

    async open(task: string, folder: string): Promise<ToolResult> {
        let n = 1;
        while (this.shells.has(n)) n++;
        if (n > L.shells) return fault(`${L.shells} shells are open, the most there can be; close one you're done with first`);
        const id = this.terminalId(n);
        const s = new Shell(n, id, task, folder, Date.now());
        const t = this.deps.terminals;
        s.offs.push(
            t.onData(id, (d) => s.feed(d)),
            t.onForeground(id, (name) => {
                s.program = name;
                s.wake();
                this.deps.changed();
            }),
            t.onExit(id, (code) => this.exited(s, code)),
        );
        this.shells.set(n, s);
        try {
            if (await t.exists(id)) await t.destroy(id);
            // pagers wait for keys; a command's output should simply end. A command that would open a browser
            // (gh auth login) prints its link instead, for the agent to open in its own
            const env = { PAGER: "cat", GIT_PAGER: "cat", MANPAGER: "cat", SYSTEMD_PAGER: "", ...loginEnv(this.deps.platform ?? process.platform) };
            await t.create(id, { cols: COLS, rows: ROWS, cwd: folder, env });
            await s.settle(START_MS, () => s.idle);
            if (!s.idle) {
                const said = s.cursorLine().trim();
                throw new Error(
                    s.exited !== undefined
                        ? `the shell ended as it started${s.exited === null ? "" : ` (exit code ${s.exited})`}`
                        : `the shell didn't show a prompt Paperboard can follow within ${START_MS / 1000} seconds${said ? ` (it shows "${said}")` : ""}; it needs to be bash, zsh, fish or PowerShell`,
                );
            }
        } catch (e) {
            await this.drop(s);
            return fault(`Couldn't open a shell: ${errorMessage(e)}`);
        }
        this.deps.changed();
        return { text: `Shell ${n} is open in ${folder}, for "${task}". Run commands in it with user_shell_run; close it with user_shell_close when the task is done.` };
    }

    private exited(s: Shell, code: number | undefined) {
        if (this.shells.get(s.n) !== s) return;
        s.exited = code ?? null;
        s.wake();
        this.shells.delete(s.n);
        s.dispose();
        this.deps.changed();
    }

    private async drop(s: Shell) {
        if (this.shells.get(s.n) === s) this.shells.delete(s.n);
        if (s.exited !== undefined) return; // it ended by itself and is already gone
        for (const off of s.offs.splice(0)) off();
        try {
            await this.deps.terminals.destroy(s.id);
        } finally {
            s.dispose();
        }
    }

    async close(raw: unknown): Promise<string> {
        const s = this.shell(raw);
        await this.drop(s);
        this.deps.changed();
        return `Shell ${s.n} is closed.`;
    }

    /** Every shell closes: the conversation is put away, or the service stops. */
    async closeAll(): Promise<void> {
        const all = [...this.shells.values()];
        if (!all.length) return;
        const results = await Promise.allSettled(all.map((s) => this.drop(s)));
        this.deps.changed();
        const failed = results.find((r) => r.status === "rejected");
        if (failed) throw (failed as PromiseRejectedResult).reason;
    }

    async run(raw: unknown, command: unknown, wait: unknown): Promise<ToolResult> {
        const s = this.shell(raw);
        if (typeof command !== "string" || !command.trim()) return fault("give the command to run");
        if (command.length > L.commandChars) return fault(`a command is up to ${L.commandChars} characters; put a longer script in a file and run that`);
        if (/[\r\n]/.test(command)) return fault("a command is one line: chain steps with && or ;, or write a script to a file and run it");
        const ms = waitSeconds(wait);
        if (typeof ms === "string") return fault(ms);
        if (!s.idle) return fault(`shell ${s.n} is still running \`${s.run?.command || s.program}\`: answer it with user_shell_send, or stop it by pressing ctrl-c`);
        const before = s.run;
        await this.deps.terminals.write(s.id, `${command}\r`);
        // the command shows as running once the shell marks it; one that finishes at once may never be seen running
        await s.settle(ms * 1000, () => s.run !== before && s.run?.end != null && s.idle);
        if (s.exited !== undefined) return { text: `Shell ${s.n} ended${s.exited === null ? "" : ` with exit code ${s.exited}`}; open another if you need one.` };
        if (s.run && s.run !== before) s.run.command = command;
        if (s.run === before || !s.run) {
            // nothing started: the shell is waiting for the rest of the line (an open quote)
            return { text: `The shell hasn't started \`${command}\`. It shows: ${s.cursorLine().trim() || "(nothing)"}. Finish the line with user_shell_send, or press ctrl-c.` };
        }
        return this.report(s);
    }

    async send(raw: unknown, text: unknown, keys: unknown, wait: unknown): Promise<ToolResult> {
        const s = this.shell(raw);
        if (text !== undefined && typeof text !== "string") return fault("text is what to type");
        if (keys !== undefined && (!Array.isArray(keys) || keys.some((k) => typeof k !== "string" || !(k in KEYS)))) return fault(`keys are any of ${SHELL_KEYS.join(", ")}`);
        const ms = waitSeconds(wait);
        if (typeof ms === "string") return fault(ms);
        if (typeof text === "string" && text.length > L.commandChars) return fault(`type up to ${L.commandChars} characters at a time`);
        const pressed = (keys as string[] | undefined) ?? [];
        if (s.idle && (text || pressed.some((k) => k !== "ctrl-c"))) return fault(`shell ${s.n} is at its prompt; run a command with user_shell_run`);
        // a password never goes through the agent
        if (text && s.program === "sudo") return fault(SUDO_HERE);
        const data = (text ?? "") + pressed.map((k) => { const v = KEYS[k]!; return typeof v === "function" ? v(s.appCursor) : v; }).join("");
        if (data) await this.deps.terminals.write(s.id, data);
        await s.settle(ms * 1000, () => s.idle);
        if (s.exited !== undefined) return { text: `Shell ${s.n} ended${s.exited === null ? "" : ` with exit code ${s.exited}`}.` };
        if (!s.run) return { text: `Shell ${s.n} is at its prompt.` };
        return this.report(s);
    }

    /** What the running (or just finished) command shows that the agent hasn't seen, and how it stands. */
    private report(s: Shell): ToolResult {
        const r = s.run!;
        const { lines, cut } = s.lines(r.start, r.end);
        let from = 0;
        while (from < r.shown.length && from < lines.length && r.shown[from] === lines[from]) from++;
        r.shown = lines;
        const fresh = lines.slice(from).join("\n");
        const notes = [cut ? "[the start of the output scrolled past what's kept]" : "", from > 0 ? `[${from} line${from === 1 ? "" : "s"} you've seen above]` : ""].filter(Boolean);
        const output = cutText([...notes, fresh].filter(Boolean).join("\n"));
        const name = r.command ? `\`${r.command}\`` : "The command";
        if (r.end) {
            const code = r.exitCode;
            const head = code === null ? `${name} ended.` : `${name} exited with ${code}.`;
            return { isError: code !== null && code !== 0, text: `${head}${output ? `\n\n${output}` : from > 0 ? "" : " (no output)"}` };
        }
        const front = s.program && s.program !== r.command.split(/\s/)[0] ? ` (${s.program} in front)` : "";
        const sudo = s.program === "sudo" ? ` ${SUDO_HERE}` : " If it's asking something, answer with user_shell_send; to wait for more, user_shell_send with nothing to type.";
        return { text: `${name} is still running${front}.${sudo}${output ? `\n\nNew on its screen:\n${output}` : "\n\nNothing new on its screen."}` };
    }
}
