// The user's own computer, which the agent reaches only with their say-so.
//
// The agent asks for what a task needs in one request (request_access): up
// to LIMITS.access.items folders, and shells, with a reason. The user
// answers on a card in the chat: for this time, for good, or no. A folder
// lets the agent list, read, search and write files under it. Anything else
// (deleting, installing, building, signing in to a command-line tool) is done
// in a shell the agent opens for the task and keeps until it's done
// (userShells.ts): commands run there as the user, and sudo only with the
// password they type on a card.
//
// Grants for good live in access.json and are listed on the Access page,
// where they're taken back, beside the open shells, which close there. A
// grant for this time lasts until the turn the answer starts is over; a
// shell opened under it stays open for its task. Every path is resolved
// through its links before it's checked, so a link inside an allowed folder
// can't lead outside it.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { errorMessage, isRecord, problemsApi } from "@mileniumhq/paperapi";
import { writeFileAtomicSync } from "@mileniumhq/paperapi/fs";
import { LIMITS, PANEL_ID, type AccessEntry, type AccessGrant, type AccessItem, type AccessView, type SudoEntry } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { fault, type Toolset } from "./toolsets";
import { OUTPUT_CHARS } from "./shell";
import { SHELL_KEYS, UserShells, type Terminals } from "./userShells";

const L = LIMITS.access;
const WRITE_BYTES = 2 * 1024 * 1024;
const SEARCH_FILES = 20_000;
const SEARCH_FILE_BYTES = 1024 * 1024;
/** the biggest file read loads whole: offsets count characters, so it has to be decoded from the start */
const READ_FILE_BYTES = 8 * 1024 * 1024;
const SEARCH_HITS = 200;
const LIST_ENTRIES = 500;
/** folders a search doesn't go into unless it's asked to start there */
const SEARCH_SKIPS = new Set([".git", "node_modules"]);

const ACCESS_INSTRUCTIONS = `**The user's computer:** yours is for your work; theirs is only for when they want something on it fixed or changed (their files, projects or programs), with the \`user_computer_\` and \`user_shell_\` tools. \`request_access\` once per task, for everything it needs at the smallest scope that works (a project's folder, not their home; a shell only when files alone won't do), then end your turn: their answer starts the next. Use what's already allowed without asking again, and never ask again for something they refused unless they bring it up.
For commands, open one shell for the task, reuse it, and close it when done. A command waiting on something is yours to handle: answer its question, or for a link and code, open the link in your browser, enter the code and show a sign-in card if it needs their account. For sudo, \`request_sudo\`. Never ask for a password in the chat.`;

/**
 * The user's computer as the agent needs to know it: which system, which version and which processor, since
 * commands, downloads and paths all depend on them. Read when asked, from what the system itself says.
 */
function describeComputer(platform: NodeJS.Platform = process.platform, arch: string = process.arch, read: (file: string) => string = (f) => fs.readFileSync(f, "utf8")): string {
    const cpu = ({ x64: "x86-64", arm64: "ARM64", ia32: "x86 (32-bit)", arm: "ARM (32-bit)" } as Record<string, string>)[arch] ?? arch;
    let system: string;
    if (platform === "linux") {
        // the distribution names itself in os-release; the kernel is the same on all of them
        const release = read("/etc/os-release");
        const name = release.match(/^PRETTY_NAME="?([^"\n]+)"?$/m)?.[1] ?? release.match(/^NAME="?([^"\n]+)"?$/m)?.[1];
        system = `${name ?? "Linux"} (Linux kernel ${os.release()})`;
    } else if (platform === "darwin") {
        const plist = read("/System/Library/CoreServices/SystemVersion.plist");
        const version = plist.match(/<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
        if (!version) throw new Error("macOS didn't say its version in SystemVersion.plist");
        system = `macOS ${version}`;
    } else if (platform === "win32") {
        system = `${os.version()} (build ${os.release()})`;
    } else {
        system = `${platform} ${os.release()}`;
    }
    return `The user's computer runs ${system} on ${cpu}. Pick commands, programs and downloads for it.`;
}

const ACCESS_TOOLS: ToolSpec[] = [
    {
        name: "request_access",
        description:
            `Ask the user for access to folders and shells on their own computer, all a task needs in one request (1 to ${L.items} items). ` +
            "They answer on a card in the chat: for this time, always, or no. Returns right away; their answer starts your next turn. " +
            "A folder lets you list, read, search and write files in it. A shell runs any command as the user (deleting, installing, building, a command-line sign-in): ask for one when files alone won't do.",
        inputSchema: {
            type: "object",
            properties: {
                reason: { type: "string", description: "What you'll do, where, and why, in a sentence or two the user reads before deciding." },
                items: {
                    type: "array",
                    minItems: 1,
                    maxItems: L.items,
                    items: {
                        type: "object",
                        properties: {
                            kind: { type: "string", enum: ["folder", "shell"] },
                            path: { type: "string", description: "For a folder: its full path on the user's computer (~ is their home folder)." },
                        },
                        required: ["kind"],
                    },
                },
            },
            required: ["reason", "items"],
        },
    },
    {
        name: "user_computer_list",
        description: "List a folder on the user's computer (an allowed folder, or one inside it).",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
    {
        name: "user_computer_read",
        description: `Read a text file on the user's computer, in an allowed folder. Up to ${OUTPUT_CHARS} characters from \`offset\`. Files over ${READ_FILE_BYTES / 1024 / 1024} MB are refused; look into those with user_computer_search or head, tail or grep in a shell.`,
        inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 } }, required: ["path"] },
    },
    {
        name: "user_computer_search",
        description: `Find text in the files under a folder on the user's computer, in an allowed folder. Case-insensitive; up to ${SEARCH_HITS} matching lines.`,
        inputSchema: { type: "object", properties: { path: { type: "string" }, text: { type: "string" } }, required: ["path", "text"] },
    },
    {
        name: "user_computer_write",
        description: "Write a text file on the user's computer, in an allowed folder: it's created, or replaced whole. Folders on the way are made.",
        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
    {
        name: "user_shell_open",
        description:
            "Open a shell on the user's computer for a task, once a shell is allowed: their own shell, as them, in a folder. " +
            `Keep using it for the whole task, across turns; up to ${L.shells} are open at once. Close it with user_shell_close when the task is done.`,
        inputSchema: {
            type: "object",
            properties: {
                task: { type: "string", description: `What it's for, in a few words the user sees, like "Sign in to GitHub's CLI" (up to ${L.taskChars} characters).` },
                folder: { type: "string", description: "The full path of the folder it starts in (~ is their home folder)." },
            },
            required: ["task", "folder"],
        },
    },
    {
        name: "user_shell_run",
        description:
            "Run a command line in one of your shells on the user's computer, at its prompt. Returns when it finishes (its output and exit code), " +
            "or, while it's still running, as soon as its screen stops changing for a few seconds (or after wait_seconds): what it shows so far, so you can answer a question it asks with user_shell_send. " +
            "One line; chain steps with && or ;. Pagers are off.",
        inputSchema: {
            type: "object",
            properties: {
                shell: { type: "integer", description: "The shell's number." },
                command: { type: "string", description: "The command line, like `npm install` or `cd ~/project && git status`." },
                wait_seconds: { type: "integer", minimum: 1, maximum: 300, description: "The longest to wait before returning what it shows so far. 30 if left out; longer for slow builds or installs." },
            },
            required: ["shell", "command"],
        },
    },
    {
        name: "user_shell_send",
        description:
            "Type into, or press keys in, the command running in one of your shells: answer its question, pick from its menu, or stop it with ctrl-c. " +
            "With nothing to type or press, it waits for more output. Returns what's new on its screen, like user_shell_run. Never type a password: request_sudo for sudo, and ask the user to type any other themselves.",
        inputSchema: {
            type: "object",
            properties: {
                shell: { type: "integer", description: "The shell's number." },
                text: { type: "string", description: "What to type, as is. Add the enter key to send a line." },
                keys: { type: "array", items: { type: "string", enum: SHELL_KEYS }, description: "Keys to press after the text, in order, like [\"down\", \"enter\"]." },
                wait_seconds: { type: "integer", minimum: 1, maximum: 300, description: "The longest to wait before returning. 30 if left out." },
            },
            required: ["shell"],
        },
    },
    {
        name: "user_shell_close",
        description: "Close one of your shells on the user's computer, stopping whatever runs in it.",
        inputSchema: { type: "object", properties: { shell: { type: "integer" } }, required: ["shell"] },
    },
    {
        name: "request_sudo",
        description:
            "Ask the user to unlock sudo in one of your shells, at its prompt: they type their password on a card, straight to sudo; you never see it, and it isn't kept. " +
            "Returns right away; their answer starts your next turn. Then `sudo ...` works in that shell without a password for a few minutes after each use.",
        inputSchema: {
            type: "object",
            properties: {
                shell: { type: "integer", description: "The shell's number." },
                reason: { type: "string", description: "What you'll run as administrator, and why, in a sentence the user reads before deciding." },
            },
            required: ["shell", "reason"],
        },
    },
];

export interface AccessDeps {
    /** access.json */
    file: string;
    /** the daemon's terminals, where the agent's shells run */
    terminals: Terminals;
    /** add or update a request's card in the conversation */
    post(entry: AccessEntry | SudoEntry): void;
    /** tell the agent how it went, never refused (Conversation.tell); it starts a turn */
    tell(text: string): void;
    /** a turn is running now */
    turning(): boolean;
    onChange(view: AccessView): void;
    waitMs?: number;
    sudoWaitMs?: number;
    home?: string;
    platform?: NodeJS.Platform;
}

interface Stored {
    folders: { path: string; at: number }[];
    /** shells allowed for good: when */
    shell: number | null;
}

interface Once {
    item: AccessItem;
    at: number;
    /** turn ends to let pass before it lapses: 1 when the answer came while a turn was running */
    skip: number;
}


/** `child` is `parent` or under it (both already resolved) */
function within(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const EMPTY: Stored = { folders: [], shell: null };

export class Access {
    private stored: Stored = EMPTY;
    private error: string | null = null;
    private once: Once[] = [];
    private pending: { entry: AccessEntry; timer: ReturnType<typeof setTimeout> } | null = null;
    readonly shells: UserShells;

    constructor(private deps: AccessDeps) {
        this.shells = new UserShells({ terminals: deps.terminals, post: deps.post, tell: deps.tell, changed: () => this.changed(), platform: deps.platform, sudoWaitMs: deps.sudoWaitMs });
    }

    private described: string | null = null;

    /** The user's computer, read once: it doesn't change under a running service. */
    private computer(): string {
        try {
            this.described ??= describeComputer();
        } catch (e) {
            return `Which system the user's computer runs couldn't be read (${errorMessage(e)}). Check before running anything that depends on it.`;
        }
        return this.described;
    }

    /** Read access.json. One that can't be read grants nothing and is never written over. */
    load() {
        try {
            this.stored = fs.existsSync(this.deps.file) ? parseStored(JSON.parse(fs.readFileSync(this.deps.file, "utf8"))) : EMPTY;
            this.error = null;
        } catch (e) {
            this.stored = EMPTY;
            this.error = `${this.deps.file} can't be read (${errorMessage(e)}). Nothing in it is allowed; fix or delete the file.`;
        }
    }

    view(): AccessView {
        const grants: AccessGrant[] = [
            ...this.stored.folders.map((f) => ({ kind: "folder" as const, path: f.path, at: f.at, once: false })),
            ...(this.stored.shell === null ? [] : [{ kind: "shell" as const, at: this.stored.shell, once: false }]),
            ...this.once.map((o) => ({ ...o.item, at: o.at, once: true })),
        ];
        return { grants, shells: this.shells.view(), error: this.error };
    }

    private changed() {
        try {
            this.deps.onChange(this.view());
        } catch (e) {
            // what's allowed keeps its last copy on the page; nobody is waiting on this publish
            const title = "What Agents is allowed couldn't be shown";
            problemsApi.report(PANEL_ID, { key: title, title, message: errorMessage(e) });
        }
    }

    private save() {
        if (this.error) throw new Error(this.error);
        writeFileAtomicSync(this.deps.file, JSON.stringify(this.stored, null, 2));
    }

    /** a turn ended: grants for this time that were used up lapse */
    turnEnded() {
        const before = this.once.length;
        this.once = this.once.flatMap((o) => (o.skip > 0 ? [{ ...o, skip: o.skip - 1 }] : []));
        if (this.once.length !== before) this.changed();
    }

    /** Take a grant back: the same folder or command, for good or for this time. */
    revoke(raw: unknown): AccessView {
        const item = parseItem(raw, this.deps.home);
        const match = (x: AccessItem) => (item.kind === "folder" ? x.kind === "folder" && x.path === item.path : x.kind === "shell");
        const folders = this.stored.folders.filter((f) => !match({ kind: "folder", path: f.path }));
        const shell = item.kind === "shell" ? null : this.stored.shell;
        const once = this.once.filter((o) => !match(o.item));
        if (folders.length === this.stored.folders.length && shell === this.stored.shell && once.length === this.once.length) {
            throw new Error("That isn't allowed now, so there's nothing to take back.");
        }
        if (folders.length !== this.stored.folders.length || shell !== this.stored.shell) {
            const prev = this.stored;
            this.stored = { folders, shell };
            try {
                this.save();
            } catch (e) {
                this.stored = prev;
                throw e;
            }
        }
        this.once = once;
        this.changed();
        return this.view();
    }

    // ------------------------------------------------------------- what's allowed

    private folders(): string[] {
        return [...this.stored.folders.map((f) => f.path), ...this.once.flatMap((o) => (o.item.kind === "folder" ? [o.item.path] : []))];
    }

    private shellAllowed(): boolean {
        return this.stored.shell !== null || this.once.some((o) => o.item.kind === "shell");
    }

    /** Resolve a path through its links (the part that exists) and check it's in an allowed folder. */
    private allowed(raw: unknown): string {
        if (typeof raw !== "string" || !raw.trim()) throw new Error("give a path");
        const wanted = resolvePath(raw, this.deps.home);
        const real = realPath(wanted);
        for (const f of this.folders()) {
            let root: string;
            try {
                root = fs.realpathSync(f);
            } catch {
                continue;
            }
            if (within(real, root)) return real;
        }
        throw new Error(`${wanted} isn't in a folder the user allowed. Ask with request_access first.`);
    }

    private summary(): string {
        const v = this.view();
        if (!v.grants.length) return "Nothing is allowed yet.";
        return v.grants
            .map((g) => `- ${g.kind === "folder" ? `folder ${g.path}` : "shells"}${g.once ? " (this time)" : ""}`)
            .join("\n");
    }

    // ------------------------------------------------------------- the agent's tools

    toolset(): Toolset {
        return {
            id: "access",
            // a flow has no one to answer a request, but may use what's allowed
            tools: (mode) => (mode.fromFlow ? ACCESS_TOOLS.filter((t) => t.name !== "request_access" && t.name !== "request_sudo") : ACCESS_TOOLS),
            instructions: () => ACCESS_INSTRUCTIONS,
            context: (mode) =>
                `${this.computer()}\nAllowed on it:\n${this.summary()}\nYour shells on it:\n${this.shells.summary()}${mode.fromFlow ? "\nThis turn answers an automation: you can't ask for more." : ""}`,
            call: async (name, args) => {
                try {
                    switch (name) {
                        case "request_access":
                            return this.request(args);
                        case "user_computer_list":
                            return this.list(args);
                        case "user_computer_read":
                            return this.read(args);
                        case "user_computer_search":
                            return this.search(args);
                        case "user_computer_write":
                            return this.write(args);
                        case "user_shell_open":
                            return await this.openShell(args);
                        case "user_shell_run":
                            return await this.shells.run(args.shell, args.command, args.wait_seconds);
                        case "user_shell_send":
                            return await this.shells.send(args.shell, args.text, args.keys, args.wait_seconds);
                        case "user_shell_close":
                            return { text: await this.shells.close(args.shell) };
                        case "request_sudo":
                            return await this.shells.requestSudo(args.shell, args.reason);
                    }
                    return fault(`unknown tool ${name}`);
                } catch (e) {
                    console.warn(`[agents] ${name} failed:`, errorMessage(e));
                    return fault(errorMessage(e));
                }
            },
        };
    }

    private request(args: Record<string, unknown>): ToolResult {
        if (this.error) return fault(`The user's grants can't be read, so nothing can be asked for: ${this.error}`);
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason || reason.length > L.reasonChars) return fault(`give a reason of up to ${L.reasonChars} characters: what you'll do, where, and why`);
        if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > L.items) return fault(`ask for 1 to ${L.items} folders, and a shell`);
        const items: AccessItem[] = [];
        for (const raw of args.items) {
            const item = parseItem(raw, this.deps.home);
            if (item.kind === "folder") {
                let stat: fs.Stats;
                try {
                    stat = fs.statSync(item.path);
                } catch (e) {
                    return fault((e as NodeJS.ErrnoException).code === "ENOENT" ? `${item.path} doesn't exist on the user's computer` : `${item.path} can't be looked at: ${errorMessage(e)}`);
                }
                if (!stat.isDirectory()) return fault(`${item.path} is a file; ask for the folder it's in`);
            }
            if (items.some((x) => JSON.stringify(x) === JSON.stringify(item))) continue;
            items.push(item);
        }

        this.lapse(); // the one before, unanswered, is replaced
        const entry: AccessEntry = { id: crypto.randomBytes(8).toString("hex"), at: Date.now(), kind: "access", reason, items, status: "waiting" };
        const timer = setTimeout(() => {
            if (this.pending?.entry.id !== entry.id) return;
            this.lapse();
            this.deps.tell("The user didn't answer your request for access in time; it has lapsed.");
        }, this.deps.waitMs ?? L.waitMinutes * 60_000);
        this.pending = { entry, timer };
        this.deps.post(entry);
        return { text: "Asked the user. They answer on a card in the chat; their answer starts your next turn. Don't wait for it: finish this turn." };
    }

    /** The user's answer: for this time, always, or no. */
    answer(id: unknown, how: unknown): { status: AccessEntry["status"] } {
        const p = this.pending;
        if (!p || p.entry.id !== id || p.entry.status !== "waiting") throw new Error("That request isn't waiting anymore.");
        if (how !== "once" && how !== "always" && how !== "decline") throw new Error('answer "once", "always" or "decline"');
        // a waiting request is always this service's, so its items are folders and shells
        const items = p.entry.items as AccessItem[];
        if (how === "always") {
            const prev = this.stored;
            const now = Date.now();
            const next: Stored = { folders: [...prev.folders], shell: prev.shell };
            for (const item of items) {
                if (item.kind === "folder" && !next.folders.some((f) => f.path === item.path)) next.folders.push({ path: item.path, at: now });
                if (item.kind === "shell") next.shell ??= now;
            }
            if (next.folders.length > L.always) throw new Error(`At most ${L.always} things can be allowed for good; take some back on the Access page first.`);
            this.stored = next;
            try {
                this.save();
            } catch (e) {
                this.stored = prev;
                throw new Error(`Not saved: ${errorMessage(e)}`);
            }
        }
        if (how === "once") {
            const skip = this.deps.turning() ? 1 : 0;
            for (const item of items) this.once.push({ item, at: Date.now(), skip });
        }
        clearTimeout(p.timer);
        const status = how === "once" ? "allowed" : how === "always" ? "always" : "declined";
        this.finish(status);
        this.changed();
        const list = items.map(describe).join("; ");
        this.deps.tell(
            how === "decline"
                ? `The user said no to: ${list}. Don't ask again for it unless they bring it up.`
                : `The user allowed ${how === "always" ? "for good" : "for this turn"}: ${list}. Go ahead with what you asked it for.`,
        );
        return { status };
    }

    /** The conversation is put away or the service stops: the request lapses (its card says so), and so does every grant for this time and every shell. */
    async shutdown() {
        this.lapse();
        if (this.once.length) {
            this.once = [];
            this.changed();
        }
        await this.shells.closeAll();
    }

    /** A shell the user closed on the Access page. */
    async closeShell(id: unknown): Promise<AccessView> {
        await this.shells.close(id);
        this.deps.tell(`The user closed shell ${String(id)}.`);
        return this.view();
    }

    private lapse() {
        const p = this.pending;
        if (!p || p.entry.status !== "waiting") return;
        clearTimeout(p.timer);
        this.finish("expired");
    }

    private finish(status: AccessEntry["status"]) {
        const p = this.pending;
        if (!p) return;
        p.entry = { ...p.entry, status };
        this.deps.post(p.entry);
        this.pending = null;
    }


    private list(args: Record<string, unknown>): ToolResult {
        const dir = this.allowed(args.path);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const lines = entries.slice(0, LIST_ENTRIES).map((e) => {
            if (e.isDirectory()) return `${e.name}/`;
            if (e.isSymbolicLink()) return `${e.name} (link)`;
            try {
                return `${e.name}  ${fs.statSync(path.join(dir, e.name)).size} bytes`;
            } catch (err) {
                console.warn(`[agents] couldn't read the size of ${path.join(dir, e.name)}:`, errorMessage(err));
                return `${e.name}  (size unreadable)`;
            }
        });
        const more = entries.length > LIST_ENTRIES ? `\n…and ${entries.length - LIST_ENTRIES} more` : "";
        return { text: `${dir}\n${lines.join("\n") || "(empty)"}${more}` };
    }

    private read(args: Record<string, unknown>): ToolResult {
        const file = this.allowed(args.path);
        const offset = args.offset === undefined ? 0 : Number(args.offset);
        if (!Number.isInteger(offset) || offset < 0) return fault("offset is a whole number of characters from the start");
        const size = fs.statSync(file).size;
        if (size > READ_FILE_BYTES) return fault(`${file} is ${size} bytes, too big to read whole (the limit is ${READ_FILE_BYTES}); look inside it with user_computer_search, or with head, tail or grep in a shell`);
        const buf = fs.readFileSync(file);
        if (buf.subarray(0, 8000).includes(0)) return fault(`${file} isn't a text file`);
        const text = buf.toString("utf8");
        const part = text.slice(offset, offset + OUTPUT_CHARS);
        const left = text.length - offset - part.length;
        return { text: part + (left > 0 ? `\n\n[${left} more characters; read on from offset ${offset + part.length}]` : "") };
    }

    private search(args: Record<string, unknown>): ToolResult {
        const root = this.allowed(args.path);
        const text = typeof args.text === "string" ? args.text.toLowerCase() : "";
        if (!text) return fault("give the text to find");
        const hits: string[] = [];
        let files = 0;
        let unreadable = 0;
        let stopped = "";
        const skipped = new Set<string>();
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (hits.length >= SEARCH_HITS) return void (stopped ||= `stopped at ${SEARCH_HITS} matching lines`);
                if (files >= SEARCH_FILES) return void (stopped ||= `stopped after ${SEARCH_FILES} files`);
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (SEARCH_SKIPS.has(e.name)) skipped.add(e.name);
                    else walk(full);
                    continue;
                }
                if (!e.isFile()) continue;
                files++;
                let buf: Buffer;
                try {
                    if (fs.statSync(full).size > SEARCH_FILE_BYTES) continue;
                    buf = fs.readFileSync(full);
                } catch {
                    // counted and said, so "No matches." never hides files that weren't searched
                    unreadable++;
                    continue;
                }
                if (buf.subarray(0, 8000).includes(0)) continue;
                buf.toString("utf8")
                    .split("\n")
                    .forEach((line, i) => {
                        if (hits.length < SEARCH_HITS && line.toLowerCase().includes(text)) hits.push(`${path.relative(root, full)}:${i + 1}: ${line.trim().slice(0, 300)}`);
                    });
            }
        };
        walk(root);
        const notes = [stopped, skipped.size ? `skipped ${[...skipped].join(" and ")} folders; search one by starting in it` : "", unreadable ? `${unreadable} file${unreadable === 1 ? "" : "s"} couldn't be read` : ""].filter(Boolean);
        return { text: `${hits.join("\n") || "No matches."}${notes.length ? `\n\n[${notes.join("; ")}]` : ""}` };
    }

    private write(args: Record<string, unknown>): ToolResult {
        if (typeof args.content !== "string") return fault("give the file's content as text");
        if (Buffer.byteLength(args.content) > WRITE_BYTES) return fault(`a file written this way is limited to ${WRITE_BYTES / 1024 / 1024} MB`);
        const file = this.allowed(args.path);
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return fault(`${file} is a folder`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, args.content);
        return { text: `Wrote ${file} (${Buffer.byteLength(args.content)} bytes).` };
    }

    private async openShell(args: Record<string, unknown>): Promise<ToolResult> {
        if (!this.shellAllowed()) return fault("A shell isn't allowed. Ask with request_access first.");
        const task = typeof args.task === "string" ? args.task.trim() : "";
        if (!task || task.length > L.taskChars) return fault(`say what the shell is for in up to ${L.taskChars} characters`);
        if (typeof args.folder !== "string" || !args.folder.trim()) return fault("give the folder it starts in");
        const folder = realPath(resolvePath(args.folder, this.deps.home));
        if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return fault(`${folder} isn't a folder on the user's computer`);
        return this.shells.open(task, folder);
    }
}

export function describe(item: AccessItem): string {
    return item.kind === "folder" ? `the folder ${item.path}` : "shells, to run commands in";
}

/** ~ is the home folder; anything else must be a full path */
function resolvePath(raw: string, home = os.homedir()): string {
    const p = raw.trim();
    if (p.length > L.pathChars || p.includes("\0")) throw new Error(`a path is up to ${L.pathChars} characters`);
    const expanded = p === "~" ? home : p.startsWith("~/") || p.startsWith("~\\") ? path.join(home, p.slice(2)) : p;
    if (!path.isAbsolute(expanded)) throw new Error(`${p} isn't a full path; start it from / or ~ (or a drive, on Windows)`);
    return path.resolve(expanded);
}

/** the path with its existing part resolved through links; what doesn't exist yet is joined on as written */
function realPath(p: string): string {
    const rest: string[] = [];
    let at = p;
    for (;;) {
        try {
            return path.join(fs.realpathSync(at), ...rest.reverse());
        } catch {
            const up = path.dirname(at);
            if (up === at) return p;
            rest.push(path.basename(at));
            at = up;
        }
    }
}

function parseItem(raw: unknown, home?: string): AccessItem {
    if (!isRecord(raw)) throw new Error("each item is a folder or a command");
    if (raw.kind === "folder") return { kind: "folder", path: realPath(resolvePath(String(raw.path ?? ""), home)) };
    if (raw.kind === "shell") return { kind: "shell" };
    throw new Error('each item\'s kind is "folder" or "shell"');
}

/**
 * access.json. Files written before shells held single commands the user allowed (`commands`): those grants
 * are gone with the way of running them, and the agent asks for a shell instead.
 */
function parseStored(raw: unknown): Stored {
    if (!isRecord(raw) || !Array.isArray(raw.folders)) throw new Error("it isn't a list of folders");
    if (raw.shell !== undefined && raw.shell !== null && typeof raw.shell !== "number") throw new Error("its shell grant is broken");
    return {
        folders: raw.folders.map((f) => {
            if (!isRecord(f) || typeof f.path !== "string" || typeof f.at !== "number") throw new Error("a folder entry is broken");
            return { path: f.path, at: f.at };
        }),
        shell: typeof raw.shell === "number" ? raw.shell : null,
    };
}
