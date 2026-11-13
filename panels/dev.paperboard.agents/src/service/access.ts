// The user's own computer, which the agent reaches only with their say-so.
//
// The agent asks for what a task needs in one request (request_access): up
// to LIMITS.access.items folders and commands, with a reason. The user
// answers on a card in the chat: for this time, for good, or no. A folder
// lets the agent list, read, search and write files under it; anything else,
// deleting included, is a command, and a command is one program with its
// arguments (never a shell line), run in an allowed folder.
//
// Grants for good live in access.json and are listed on the Access page,
// where they're taken back. A grant for this time lasts until the turn the
// answer starts is over. Every path is resolved through its links before
// it's checked, so a link inside an allowed folder can't lead outside it.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS, type AccessEntry, type AccessGrant, type AccessItem, type AccessView } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Launch } from "./which";
import type { Toolset } from "./toolsets";

const L = LIMITS.access;
/** what one read or one command may hand back before the rest is cut */
export const OUTPUT_CHARS = 30_000;
const RUN_MS = 5 * 60_000;
const WRITE_BYTES = 2 * 1024 * 1024;
const SEARCH_FILES = 20_000;
const SEARCH_FILE_BYTES = 1024 * 1024;
/** the biggest file read loads whole: offsets count characters, so it has to be decoded from the start */
const READ_FILE_BYTES = 8 * 1024 * 1024;
const SEARCH_HITS = 200;
const LIST_ENTRIES = 500;
/** folders a search doesn't go into unless it's asked to start there */
const SEARCH_SKIPS = new Set([".git", "node_modules"]);

export const ACCESS_INSTRUCTIONS = `**The user's computer:** yours is for your work; theirs is only for when they want something on it fixed or changed (their files, projects or programs), with the \`user_computer_\` tools. \`request_access\` once per task, for everything it needs at the smallest scope that works (a project's folder, not their home), then end your turn: their answer starts the next. Use what's already allowed without asking again, and never ask again for something they refused unless they bring it up.`;

/**
 * The user's computer as the agent needs to know it: which system, which version and which processor, since
 * commands, downloads and paths all depend on them. Read when asked, from what the system itself says.
 */
export function describeComputer(platform: NodeJS.Platform = process.platform, arch: string = process.arch, read: (file: string) => string = (f) => fs.readFileSync(f, "utf8")): string {
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

export const ACCESS_TOOLS: ToolSpec[] = [
    {
        name: "request_access",
        description:
            `Ask the user for access to folders and commands on their own computer, all a task needs in one request (1 to ${L.items}). ` +
            "They answer on a card in the chat: for this time, always, or no. Returns right away; their answer starts your next turn. " +
            "A folder lets you list, read, search and write files in it. Deleting, moving, installing or building is a command, and is asked for: one program and its arguments, never a shell line.",
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
                            kind: { type: "string", enum: ["folder", "command"] },
                            path: { type: "string", description: "For a folder: its full path on the user's computer (~ is their home folder)." },
                            command: { type: "array", items: { type: "string" }, description: 'For a command: the program and its arguments, like ["npm", "install"].' },
                            anyArguments: { type: "boolean", description: "For a command: it also covers more arguments after these, for when what follows will vary (`npm install` and any package name). Leave it off to allow exactly this command." },
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
        description: `Read a text file on the user's computer, in an allowed folder. Up to ${OUTPUT_CHARS} characters from \`offset\`. Files over ${READ_FILE_BYTES / 1024 / 1024} MB are refused; look into those with user_computer_search or a command like head, tail or grep.`,
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
        name: "user_computer_run",
        description: "Run an allowed command on the user's computer, in an allowed folder: one program and its arguments, no shell. Returns its output and exit code.",
        inputSchema: {
            type: "object",
            properties: {
                command: { type: "array", items: { type: "string" }, description: 'The program and its arguments, like ["npm", "install", "left-pad"].' },
                folder: { type: "string", description: "The allowed folder to run it in." },
            },
            required: ["command", "folder"],
        },
    },
];

export interface AccessDeps {
    /** access.json */
    file: string;
    findProgram(command: string, args: readonly string[]): Launch | null;
    exec(command: string, args: string[], o: { cwd: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    /** add or update the request's card in the conversation */
    post(entry: AccessEntry): void;
    /** tell the agent how it went (starts a turn) */
    notice(text: string): void;
    /** a turn is running now */
    turning(): boolean;
    onChange(view: AccessView): void;
    waitMs?: number;
    home?: string;
}

interface Stored {
    folders: { path: string; at: number }[];
    commands: { command: string[]; anyArguments: boolean; at: number }[];
}

interface Once {
    item: AccessItem;
    at: number;
    /** turn ends to let pass before it lapses: 1 when the answer came while a turn was running */
    skip: number;
}

const fault = (text: string): ToolResult => ({ isError: true, text });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `child` is `parent` or under it (both already resolved) */
function within(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const sameCommand = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export class Access {
    private stored: Stored = { folders: [], commands: [] };
    private error: string | null = null;
    private once: Once[] = [];
    private pending: { entry: AccessEntry; timer: ReturnType<typeof setTimeout> } | null = null;

    constructor(private deps: AccessDeps) {}

    private described: string | null = null;

    /** The user's computer, read once: it doesn't change under a running service. */
    private computer(): string {
        try {
            this.described ??= describeComputer();
        } catch (e) {
            return `Which system the user's computer runs couldn't be read (${e instanceof Error ? e.message : String(e)}). Check before running anything that depends on it.`;
        }
        return this.described;
    }

    /** Read access.json. One that can't be read grants nothing and is never written over. */
    load() {
        try {
            this.stored = fs.existsSync(this.deps.file) ? parseStored(JSON.parse(fs.readFileSync(this.deps.file, "utf8"))) : { folders: [], commands: [] };
            this.error = null;
        } catch (e) {
            this.stored = { folders: [], commands: [] };
            this.error = `${this.deps.file} can't be read (${message(e)}). Nothing in it is allowed; fix or delete the file.`;
        }
    }

    view(): AccessView {
        const grants: AccessGrant[] = [
            ...this.stored.folders.map((f) => ({ kind: "folder" as const, path: f.path, at: f.at, once: false })),
            ...this.stored.commands.map((c) => ({ kind: "command" as const, command: c.command, anyArguments: c.anyArguments, at: c.at, once: false })),
            ...this.once.map((o) => ({ ...o.item, at: o.at, once: true })),
        ];
        return { grants, error: this.error };
    }

    private changed() {
        try {
            this.deps.onChange(this.view());
        } catch (e) {
            console.error("[agents] couldn't publish what's allowed:", message(e));
        }
    }

    private save() {
        if (this.error) throw new Error(this.error);
        const tmp = `${this.deps.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.stored, null, 2));
        fs.renameSync(tmp, this.deps.file);
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
        const match = (x: AccessItem) => (item.kind === "folder" ? x.kind === "folder" && x.path === item.path : x.kind === "command" && sameCommand(x.command, item.command) && x.anyArguments === item.anyArguments);
        const folders = this.stored.folders.filter((f) => !match({ kind: "folder", path: f.path }));
        const commands = this.stored.commands.filter((c) => !match({ kind: "command", command: c.command, anyArguments: c.anyArguments }));
        const once = this.once.filter((o) => !match(o.item));
        if (folders.length === this.stored.folders.length && commands.length === this.stored.commands.length && once.length === this.once.length) {
            throw new Error("That isn't allowed now, so there's nothing to take back.");
        }
        if (folders.length !== this.stored.folders.length || commands.length !== this.stored.commands.length) {
            const prev = this.stored;
            this.stored = { folders, commands };
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

    private commandAllowed(argv: string[]): boolean {
        const all = [...this.stored.commands, ...this.once.flatMap((o) => (o.item.kind === "command" ? [o.item] : []))];
        return all.some((c) => (c.anyArguments ? argv.length >= c.command.length : argv.length === c.command.length) && c.command.every((x, i) => x === argv[i]));
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
            .map((g) => `- ${g.kind === "folder" ? `folder ${g.path}` : `command \`${g.command.join(" ")}\`${g.anyArguments ? " (and more arguments)" : ""}`}${g.once ? " (this time)" : ""}`)
            .join("\n");
    }

    // ------------------------------------------------------------- the agent's tools

    toolset(): Toolset {
        return {
            id: "access",
            // a flow has no one to answer a request, but may use what's allowed
            tools: (mode) => (mode.fromFlow ? ACCESS_TOOLS.filter((t) => t.name !== "request_access") : ACCESS_TOOLS),
            instructions: () => ACCESS_INSTRUCTIONS,
            context: (mode) => `${this.computer()}\nAllowed on it:\n${this.summary()}${mode.fromFlow ? "\nThis turn answers an automation: you can't ask for more." : ""}`,
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
                        case "user_computer_run":
                            return await this.run(args);
                    }
                    return fault(`unknown tool ${name}`);
                } catch (e) {
                    console.warn(`[agents] ${name} failed:`, message(e));
                    return fault(message(e));
                }
            },
        };
    }

    private request(args: Record<string, unknown>): ToolResult {
        if (this.error) return fault(`The user's grants can't be read, so nothing can be asked for: ${this.error}`);
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason || reason.length > L.reasonChars) return fault(`give a reason of up to ${L.reasonChars} characters: what you'll do, where, and why`);
        if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > L.items) return fault(`ask for 1 to ${L.items} folders and commands`);
        const items: AccessItem[] = [];
        for (const raw of args.items) {
            const item = parseItem(raw, this.deps.home);
            if (item.kind === "folder") {
                let stat: fs.Stats;
                try {
                    stat = fs.statSync(item.path);
                } catch {
                    return fault(`${item.path} doesn't exist on the user's computer`);
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
            this.tell("The user didn't answer your request for access in time; it has lapsed.");
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
        const items = p.entry.items;
        if (how === "always") {
            const prev = this.stored;
            const now = Date.now();
            const next: Stored = { folders: [...prev.folders], commands: [...prev.commands] };
            for (const item of items) {
                if (item.kind === "folder" && !next.folders.some((f) => f.path === item.path)) next.folders.push({ path: item.path, at: now });
                if (item.kind === "command" && !next.commands.some((c) => sameCommand(c.command, item.command) && c.anyArguments === item.anyArguments)) {
                    next.commands.push({ command: item.command, anyArguments: item.anyArguments, at: now });
                }
            }
            if (next.folders.length + next.commands.length > L.always) throw new Error(`At most ${L.always} things can be allowed for good; take some back on the Access page first.`);
            this.stored = next;
            try {
                this.save();
            } catch (e) {
                this.stored = prev;
                throw new Error(`Not saved: ${message(e)}`);
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
        this.tell(
            how === "decline"
                ? `The user said no to: ${list}. Don't ask again for it unless they bring it up.`
                : `The user allowed ${how === "always" ? "for good" : "for this turn"}: ${list}. Go ahead with what you asked it for.`,
        );
        return { status };
    }

    /** The conversation is put away or the service stops: the request lapses (its card says so) and so does every grant for this time. */
    shutdown() {
        this.lapse();
        if (!this.once.length) return;
        this.once = [];
        this.changed();
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

    private tell(text: string) {
        try {
            this.deps.notice(text);
        } catch (e) {
            // the card already shows the answer; the agent hears of it when it's next asked
            console.error("[agents] couldn't tell the agent about access:", message(e));
        }
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
                console.warn(`[agents] couldn't read the size of ${path.join(dir, e.name)}:`, message(err));
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
        if (size > READ_FILE_BYTES) return fault(`${file} is ${size} bytes, too big to read whole (the limit is ${READ_FILE_BYTES}); look inside it with user_computer_search, or with head, tail or grep through user_computer_run`);
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
        const notes = [stopped, skipped.size ? `skipped ${[...skipped].join(" and ")} folders; search one by starting in it` : ""].filter(Boolean);
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

    private async run(args: Record<string, unknown>): Promise<ToolResult> {
        const argv = parseCommand(args.command);
        const cwd = this.allowed(args.folder);
        if (!fs.statSync(cwd).isDirectory()) return fault(`${cwd} is a file; run it in a folder`);
        if (!this.commandAllowed(argv)) return fault(`\`${argv.join(" ")}\` isn't allowed. Ask with request_access first.`);
        const launch = this.deps.findProgram(argv[0]!, argv.slice(1));
        if (!launch) return fault(`"${argv[0]}" isn't installed on the user's computer`);
        const r = await this.deps.exec(launch.command, launch.args, { cwd, timeoutMs: RUN_MS });
        const out = [r.stdout && `output:\n${r.stdout}`, r.stderr && `errors:\n${r.stderr}`].filter(Boolean).join("\n\n");
        const cut = out.length > OUTPUT_CHARS ? `${out.slice(0, OUTPUT_CHARS)}\n[cut: ${out.length - OUTPUT_CHARS} more characters]` : out;
        return { isError: r.exitCode !== 0, text: `\`${argv.join(" ")}\` in ${cwd} exited with ${r.exitCode}.${cut ? `\n\n${cut}` : ""}` };
    }
}

export function describe(item: AccessItem): string {
    return item.kind === "folder" ? `the folder ${item.path}` : `\`${item.command.join(" ")}\`${item.anyArguments ? " with any arguments after" : ""}`;
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

function parseCommand(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > L.commandArgs) throw new Error(`a command is a list of its program and arguments, up to ${L.commandArgs}`);
    if (!raw.every((a) => typeof a === "string" && a.length <= L.argChars && !a.includes("\0"))) throw new Error(`each argument is text of up to ${L.argChars} characters`);
    if (!(raw[0] as string).trim()) throw new Error("the command needs a program");
    if (/\s/.test(raw[0] as string) && !path.isAbsolute(raw[0] as string)) throw new Error("the first item is just the program; put its arguments after it, one per item");
    return raw as string[];
}

function parseItem(raw: unknown, home?: string): AccessItem {
    if (!isRecord(raw)) throw new Error("each item is a folder or a command");
    if (raw.kind === "folder") return { kind: "folder", path: realPath(resolvePath(String(raw.path ?? ""), home)) };
    if (raw.kind === "command") {
        if (raw.anyArguments !== undefined && typeof raw.anyArguments !== "boolean") throw new Error("anyArguments is true or false");
        return { kind: "command", command: parseCommand(raw.command), anyArguments: raw.anyArguments === true };
    }
    throw new Error('each item\'s kind is "folder" or "command"');
}

function parseStored(raw: unknown): Stored {
    if (!isRecord(raw) || !Array.isArray(raw.folders) || !Array.isArray(raw.commands)) throw new Error("it isn't a list of folders and commands");
    return {
        folders: raw.folders.map((f) => {
            if (!isRecord(f) || typeof f.path !== "string" || typeof f.at !== "number") throw new Error("a folder entry is broken");
            return { path: f.path, at: f.at };
        }),
        commands: raw.commands.map((c) => {
            if (!isRecord(c) || typeof c.at !== "number" || typeof c.anyArguments !== "boolean") throw new Error("a command entry is broken");
            return { command: parseCommand(c.command), anyArguments: c.anyArguments, at: c.at };
        }),
    };
}
