// One command as administrator, which the user reads and approves. The agent
// names the command (request_sudo), the card shows exactly that command, and
// the user types their password on the card.
//
// The service then runs the system's own sudo itself, never in the agent's
// shell, where anything the agent set up (a sudo function, a PATH entry, an
// edited .bashrc) could catch the password. It runs /usr/bin/sudo, checked to
// be root's and setuid, with -k, so no unlocked timestamp is left behind for
// anything else. The password goes on stdin only once sudo's own prompt, a
// random one for this run, asks for it, and then stdin closes: the command
// runs with no input. The password goes nowhere else: not to the agent, the
// transcript or the disk.

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { errorMessage } from "@mileniumhq/paperapi";
import { LIMITS, type SudoEntry } from "../contract";
import type { ToolResult } from "./computerMcp";
import { OUTPUT_CHARS } from "./shell";
import { fault } from "./toolsets";
import { cutText } from "./userShells";

const L = LIMITS.access;
const SYSTEM_SUDO = "/usr/bin/sudo";
/** how long sudo has to ask for the password before the command is taken to run without one */
const NO_PROMPT_MS = 10_000;
/** what runs under sudo: it says on stderr that sudo let it start ($0, a nonce), then runs the command ($1) */
const ANNOUNCE = 'printf "%s\\n" "$0" >&2; exec /bin/sh -c "$1"';
const PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export interface SudoDeps {
    /** add or update the card in the conversation */
    post(entry: SudoEntry): void;
    /** tell the agent how it went, never refused (Conversation.tell); it starts a turn */
    tell(text: string): void;
    platform?: NodeJS.Platform;
    waitMs?: number;
    /** tests' stand-in for the system's sudo; the real one is checked to be root's own */
    binary?: string;
}

interface Request {
    entry: SudoEntry;
    timer: ReturnType<typeof setTimeout> | null;
    /** passwords tried */
    attempts: number;
    child: ChildProcess | null;
}

/** The system's sudo, if it's root's own: anything else at that path could keep the password. */
export function systemSudo(file = SYSTEM_SUDO): string {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(file);
    } catch (e) {
        throw new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? `sudo isn't installed (there's no ${file})` : `${file} can't be looked at: ${errorMessage(e)}`);
    }
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o4000) === 0) throw new Error(`${file} isn't the system's own sudo (a file owned by root, setuid)`);
    return file;
}

/** A command's output as it streams, kept to its start and its end, which says how it finished. */
class Output {
    private head = "";
    private tail = "";
    private dropped = 0;

    add(s: string) {
        if (this.head.length < OUTPUT_CHARS) {
            const room = OUTPUT_CHARS - this.head.length;
            this.head += s.slice(0, room);
            s = s.slice(room);
        }
        this.tail += s;
        if (this.tail.length > OUTPUT_CHARS) {
            this.dropped += this.tail.length - OUTPUT_CHARS;
            this.tail = this.tail.slice(-OUTPUT_CHARS);
        }
    }

    text(): string {
        return cutText(this.dropped ? `${this.head}\n[… ${this.dropped} characters cut …]\n${this.tail}` : this.head + this.tail).trim();
    }
}

export class Sudo {
    /** one request at a time: waiting for the user, or running */
    private current: Request | null = null;

    constructor(private deps: SudoDeps) {}

    /** The agent asks to run one command as administrator, in a folder (already resolved and checked). */
    request(command: unknown, folder: string, reason: unknown): ToolResult {
        if ((this.deps.platform ?? process.platform) === "win32") return fault("Windows has no sudo: an administrator's command needs an administrator's terminal, which the user opens themselves");
        if (typeof command !== "string" || !command.trim()) return fault("give the command to run as administrator");
        if (command.length > L.commandChars) return fault(`a command is up to ${L.commandChars} characters; put a longer script in a file and run that`);
        // the card is the user's only look at what runs as root: nothing in it may show differently from how it runs
        // (bidi controls, zero-width characters), and it's one line
        if (/[\p{Cc}\p{Cf}]/u.test(command)) return fault("a command is one line of visible characters, with no tabs or control or formatting characters: chain steps with && or ;");
        const why = typeof reason === "string" ? reason.trim() : "";
        if (!why || why.length > L.reasonChars) return fault(`give a reason of up to ${L.reasonChars} characters: what the command does, and why`);
        if (this.current?.entry.status === "running") return fault(`\`${this.current.entry.command}\` is still running as administrator; its result starts your next turn`);
        this.lapse();
        const entry: SudoEntry = { id: crypto.randomBytes(8).toString("hex"), at: Date.now(), kind: "sudo", command: command.trim(), folder, reason: why, status: "waiting" };
        this.current = { entry, timer: null, attempts: 0, child: null };
        this.wait(this.current);
        this.deps.post(entry);
        return { text: "Asked the user. The card shows them the command; if they type their password, Paperboard runs it as administrator, with no input, and its output starts your next turn. Don't wait for it: finish this turn." };
    }

    private wait(r: Request) {
        if (r.timer) clearTimeout(r.timer);
        r.timer = setTimeout(() => {
            if (this.current !== r || r.entry.status !== "waiting") return;
            this.end(r, { status: "expired", error: undefined });
            this.deps.tell(`The user didn't answer your request to run \`${r.entry.command}\` as administrator in time; it has lapsed.`);
        }, this.deps.waitMs ?? L.waitMinutes * 60_000);
    }

    /** The user's password: sudo is started for the command, and gets it once it asks. */
    async answer(id: unknown, password: unknown): Promise<void> {
        const r = this.current;
        if (!r || r.entry.id !== id || r.entry.status !== "waiting") throw new Error("That request isn't waiting anymore.");
        if (typeof password !== "string" || !password || password.length > L.passwordChars || /[\r\n]/.test(password)) throw new Error("Type your password, on one line.");
        let binary: string;
        try {
            binary = this.deps.binary ?? systemSudo();
        } catch (e) {
            this.end(r, { status: "failed", error: errorMessage(e) });
            this.deps.tell(`\`${r.entry.command}\` couldn't run as administrator: ${errorMessage(e)}.`);
            return;
        }
        if (r.timer) clearTimeout(r.timer);
        r.attempts++;
        this.update(r, { status: "running", error: undefined });

        const prompt = `[paperboard-sudo-${crypto.randomBytes(6).toString("hex")}]`;
        const started = `[paperboard-started-${crypto.randomBytes(6).toString("hex")}]`;
        const env = { PATH, LANG: process.env.LANG ?? "C.UTF-8", HOME: os.homedir(), USER: os.userInfo().username, LOGNAME: os.userInfo().username };
        const child = spawn(binary, ["-S", "-k", "-p", prompt, "--", "/bin/sh", "-c", ANNOUNCE, started, r.entry.command], { cwd: r.entry.folder, env, stdio: ["pipe", "pipe", "pipe"] });
        r.child = child;
        const out = new Output();
        let before = "";
        let asked = false;
        let refused = false;
        let stdinOpen = true;
        let overtime = false;
        /** sudo let the command start: anything that failed before then is sudo refusing */
        let ran = false;
        /** stderr's last few characters, so the start's nonce is found across chunks */
        let tail = "";
        const closeInput = () => {
            if (!stdinOpen) return;
            stdinOpen = false;
            child.stdin.end();
        };
        // no prompt: sudo didn't need a password (or is about to fail); the command must not wait on input
        const noPrompt = setTimeout(closeInput, NO_PROMPT_MS);
        const limit = setTimeout(() => {
            overtime = true;
            child.kill("SIGTERM");
        }, L.sudoRunMinutes * 60_000);

        child.stdin.on("error", (e) => {
            // quiet: sudo closed its input (it ended, or didn't read); how it ended is reported from its exit
            void e;
        });
        child.stderr.setEncoding("utf8");
        child.stdout.setEncoding("utf8");
        child.stderr.on("data", (d: string) => {
            tail = (tail + d).slice(-(started.length + d.length));
            if (!ran && tail.includes(started)) {
                ran = true;
                // it started without being asked for a password: it gets no input
                clearTimeout(noPrompt);
                closeInput();
            }
            if (asked) {
                out.add(d);
                // sudo asking again: the password was wrong. Its input is closed, so it gives up by itself
                if (!refused && d.includes(prompt)) refused = true;
                return;
            }
            before += d;
            const at = before.indexOf(prompt);
            if (at === -1) return;
            asked = true;
            clearTimeout(noPrompt);
            child.stdin.write(`${password}\n`);
            closeInput();
            out.add(before.slice(at + prompt.length));
            if (out.text().includes(prompt)) refused = true;
        });
        child.stdout.on("data", (d: string) => out.add(d));

        await new Promise<void>((resolve) => {
            child.once("spawn", () => resolve());
            child.once("error", (e) => {
                clearTimeout(noPrompt);
                clearTimeout(limit);
                if (this.current === r) {
                    this.end(r, { status: "failed", error: `sudo couldn't start: ${errorMessage(e)}` });
                    this.deps.tell(`\`${r.entry.command}\` couldn't run as administrator: sudo couldn't start (${errorMessage(e)}).`);
                }
                resolve();
            });
        });
        child.once("close", (code, signal) => {
            clearTimeout(noPrompt);
            clearTimeout(limit);
            r.child = null;
            if (this.current !== r || r.entry.status !== "running") return;
            if (!asked) out.add(before);
            if (refused) {
                if (r.attempts < L.sudoAttempts) {
                    this.update(r, { status: "waiting", error: "That password didn't work. Try again." });
                    this.wait(r);
                    return;
                }
                this.end(r, { status: "failed", error: `sudo refused the password ${L.sudoAttempts} times` });
                this.deps.tell(`sudo refused the user's password ${L.sudoAttempts} times, so \`${r.entry.command}\` didn't run. Ask again only if they want to.`);
                return;
            }
            const output = out.text().split(prompt).join("").split(`${started}\n`).join("").split(started).join("").trim();
            if (overtime) {
                this.end(r, { status: "failed", error: `it was stopped after ${L.sudoRunMinutes} minutes` });
                this.deps.tell(`\`${r.entry.command}\` ran as administrator for ${L.sudoRunMinutes} minutes, the most it can, and was stopped.${output ? `\n\n${output}` : ""}`);
                return;
            }
            // sudo refusing (not in sudoers, a policy, PAM giving up): it ended before the command said it started
            if (!ran) {
                const said = output.split("\n").find((l) => l.trim())?.trim() ?? `it exited with ${code ?? signal}`;
                this.end(r, { status: "failed", error: `sudo refused: ${said}` });
                this.deps.tell(`sudo refused to run \`${r.entry.command}\`, so it didn't run.${output ? `\n\n${output}` : ""}`);
                return;
            }
            const how = code === null ? `was stopped (${signal})` : `exited with ${code}`;
            this.end(r, code === null ? { status: "failed", error: `it ${how}` } : { status: "done", exitCode: code, error: undefined });
            this.deps.tell(`\`${r.entry.command}\` ran as administrator in ${r.entry.folder} and ${how}.${output ? `\n\n${output}` : " (no output)"}`);
        });
    }

    decline(id: unknown): void {
        const r = this.current;
        if (!r || r.entry.id !== id || r.entry.status !== "waiting") throw new Error("That request isn't waiting anymore.");
        this.end(r, { status: "declined", error: undefined });
        this.deps.tell(`The user said no to running \`${r.entry.command}\` as administrator. Don't ask again unless they bring it up.`);
    }

    /** The conversation is put away or the service stops: a waiting card lapses, and a running command is stopped. */
    shutdown(): void {
        const r = this.current;
        if (!r) return;
        if (r.entry.status === "running") {
            r.child?.kill("SIGTERM");
            this.end(r, { status: "failed", error: "it was stopped when the conversation was put away" });
            return;
        }
        this.lapse();
    }

    private lapse() {
        const r = this.current;
        if (r?.entry.status === "waiting") this.end(r, { status: "expired", error: undefined });
    }

    private update(r: Request, patch: Partial<SudoEntry>) {
        r.entry = { ...r.entry, ...patch };
        this.deps.post(r.entry);
    }

    /** the card's last word */
    private end(r: Request, patch: Partial<SudoEntry>) {
        if (r.timer) clearTimeout(r.timer);
        this.update(r, patch);
        if (this.current === r) this.current = null;
    }
}
