// What Report an Issue attaches when the person leaves it on: the computer
// they're looking at, its panels and versions, and recent log lines, so the
// maintainer (and the agent the maintainer hands it to) has more than a
// sentence to go on. Everything that could name the person, the computer or
// a network, or hold a secret, is replaced before the person even sees it.
// The person sees exactly this text before sending, and can leave it out.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MAX_DETAILS_LENGTH } from "issues/shared";

/** Log entries read from the end of the log, at most. */
const LOG_READ_BYTES = 1024 * 1024;
/** Warnings and errors kept, newest last. */
const PROBLEM_ENTRIES = 60;
/** The latest entries kept, whatever their level. */
const RECENT_ENTRIES = 80;
/** One entry (a line and its stack) is cut past this. */
const ENTRY_MAX = 2000;

export interface Scrubber {
    /** this computer's home folder, replaced by ~ */
    home: string;
    /** the signed-in account's name */
    username: string;
    /** names that identify a computer: this one's hostname, paired and discovered computers' names */
    computerNames: string[];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Secrets that show up in logs by their shape, whatever names them
const SECRET_SHAPES: RegExp[] = [
    // a JWT
    /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
    // a Discord bot token
    /\b[MNO][\w-]{23,27}\.[\w-]{6}\.[\w-]{27,40}\b/g,
    // provider API keys (OpenAI, Anthropic, GitHub, Slack, AWS, Google)
    /\b(?:sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,})/g,
];
// a secret after its name: token=…, "password": "…", Authorization: Bearer …;
// a quoted value goes whole, spaces and all
const NAMED_SECRET =
    /\b((?:access[_-]?|refresh[_-]?|api[_-]?|bot[_-]?|auth[_-]?|session[_-]?|client[_-]?)?(?:token|secret|password|passwd|passphrase|api[_-]?key|authorization|cookie|signature))(["']?\s*[:=]\s*)(?:(["'])[^"'\n]*\3|(?:Bearer\s+|Basic\s+)?[^\s"',;&)}\]]+)/gi;
// computers on the network, named where this app's log names them, and mDNS hostnames
const DISCOVERED = /(Paperboard Server (?:online|offline): )[^(\n]+?( \()/g;
const MDNS_HOST = /\b[\w-]+\.local\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const URL_USERINFO = /(\b[a-z][\w+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi;
// terminal colour codes some tools print, which aren't text
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const OTHER_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** The text with everything that could identify the person or hold a secret replaced by a placeholder. */
export function scrub(text: string, who: Scrubber): string {
    let out = text.replace(ANSI, "").replace(OTHER_CONTROL, "");
    for (const shape of SECRET_SHAPES) out = out.replace(shape, "<secret>");
    out = out.replace(NAMED_SECRET, (_all, name: string, sep: string, quote: string | undefined) => `${name}${sep}${quote ?? ""}<secret>${quote ?? ""}`);
    out = out.replace(URL_USERINFO, "$1<secret>@");
    out = out.replace(EMAIL, "<email>");
    out = out.replace(DISCOVERED, "$1<computer>$2").replace(MDNS_HOST, "<computer>");
    // the home folder, as it's written on this system and with the other slash
    if (who.home.length > 1) {
        for (const home of new Set([who.home, who.home.replace(/\\/g, "/"), who.home.replace(/\//g, "\\")])) {
            out = out.replace(new RegExp(escape(home), "gi"), "~");
        }
    }
    out = out.replace(IPV4, (ip) => (ip === "127.0.0.1" || ip === "0.0.0.0" ? ip : "<ip>"));
    out = out.replace(IPV6, "<ip>");
    const names = [...who.computerNames, who.username]
        .flatMap((name) => [name, name.split(".")[0] ?? ""])
        .map((name) => name.trim())
        .filter((name) => name.length >= 3)
        .sort((a, b) => b.length - a.length);
    for (const name of new Set(names)) {
        const placeholder = name === who.username ? "<user>" : "<computer>";
        out = out.replace(new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`, "gi"), placeholder);
    }
    return out;
}

const ENTRY_START = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;
const PROBLEM = /^\S+ \[(?:WARN|ERROR)\]/;

/** A log's text as entries: a timestamped line with the lines under it (a stack, say). */
export function logEntries(text: string): string[] {
    const entries: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        if (ENTRY_START.test(line) || entries.length === 0) entries.push(line);
        else entries[entries.length - 1] += `\n${line}`;
    }
    // the read may start mid-entry; only whole ones count
    if (entries[0] && !ENTRY_START.test(entries[0])) entries.shift();
    return entries.map((entry) => {
        // the app's own logger name says nothing here
        const tidy = entry.replace(/^(\S+ \[\w+\]) \[paperboard\]/, "$1");
        return tidy.length > ENTRY_MAX ? `${tidy.slice(0, ENTRY_MAX)} …(cut)` : tidy;
    });
}

/** The recent warnings and errors, then the latest entries of any level. */
export function logSections(entries: string[]): string {
    const problems = entries.filter((entry) => PROBLEM.test(entry)).slice(-PROBLEM_ENTRIES);
    const recent = entries.slice(-RECENT_ENTRIES);
    return [
        `Recent warnings and errors (${problems.length}, oldest first):`,
        problems.length ? problems.join("\n") : "(none)",
        "",
        `Latest log entries (${recent.length}):`,
        recent.length ? recent.join("\n") : "(none)",
    ].join("\n");
}

/** The end of the app's log, reaching into the rotated file before it when the current one is short. */
export function readLogTail(logsDir: string, name = "paperboard"): string {
    const read = (file: string, budget: number): string => {
        let fd: number;
        try {
            fd = fs.openSync(file, "r");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
            throw err;
        }
        try {
            const size = fs.fstatSync(fd).size;
            const length = Math.min(size, budget);
            const buffer = Buffer.alloc(length);
            fs.readSync(fd, buffer, 0, length, size - length);
            return buffer.toString("utf8");
        } finally {
            fs.closeSync(fd);
        }
    };
    const current = read(path.join(logsDir, `${name}.log`), LOG_READ_BYTES);
    const left = LOG_READ_BYTES - Buffer.byteLength(current);
    const before = left > 64 * 1024 ? read(path.join(logsDir, `${name}.1.log`), left) : "";
    return before + current;
}

export interface DetailsInput {
    /** which computer the person is looking at */
    computer: { kind: "this" | "paired"; os?: string; osVersion?: string; connected: boolean };
    /** how many computers are paired, besides this one */
    pairedCount: number;
    /** the panels on that computer, or why they couldn't be read */
    panels: { id: string; version?: string }[] | { error: string };
    /** the end of the app's log */
    log: string;
}

/** The diagnostics as the person sees and sends them, scrubbed and within the service's limit. */
export function buildDetails(input: DetailsInput, who: Scrubber): string {
    const { computer } = input;
    const where =
        computer.kind === "this"
            ? "this computer"
            : `a paired computer${computer.os ? ` (${[computer.os, computer.osVersion].filter(Boolean).join(" ")})` : ""}`;
    const panels =
        "error" in input.panels
            ? [`Panels: couldn't be read: ${input.panels.error}`]
            : [
                  `Panels on it (${input.panels.length}):`,
                  ...(input.panels.length
                      ? [...input.panels].sort((a, b) => a.id.localeCompare(b.id)).map((panel) => `- ${panel.id} ${panel.version ?? "(no version)"}`)
                      : ["(none)"]),
              ];
    const head = [
        `Looking at: ${where}, ${computer.connected ? "connected" : "not connected"}`,
        `Paired computers: ${input.pairedCount}`,
        ...panels,
        "",
        "From this computer's Paperboard log:",
        "",
    ].join("\n");
    const log = logSections(logEntries(input.log));
    let details = scrub(`${head}${log}`, who);
    // over the limit, the oldest log lines go first: the head and the newest lines matter most
    if (details.length > MAX_DETAILS_LENGTH) {
        const marker = "\n…(older lines cut)\n";
        const headLength = scrub(head, who).length;
        const keep = MAX_DETAILS_LENGTH - headLength - marker.length;
        details = details.slice(0, headLength) + marker + details.slice(details.length - keep);
    }
    return details;
}

/** This computer's identifying names, for scrub(). */
export function localScrubber(otherNames: string[]): Scrubber {
    return { home: os.homedir(), username: os.userInfo().username, computerNames: [os.hostname(), ...otherNames] };
}
