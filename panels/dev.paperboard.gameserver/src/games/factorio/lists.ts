import fs from "node:fs/promises";
import path from "node:path";
import { SerialQueue } from "@mileniumhq/paperapi";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";
import { unlessMissing } from "../../service/failures";

// The server's three lists, JSON files beside its saves (given to it with
// --server-adminlist, --server-banlist and --server-whitelist). A running
// server keeps them itself and writes each the moment it changes, every name
// in lower case: Paperboard changes them over RCON then (/promote, /ban,
// /whitelist add), and in the files only while the server is stopped.
// Measured on Factorio 2.1.25.

export const LIST_FILES = {
    admins: "server-adminlist.json",
    bans: "server-banlist.json",
    whitelist: "server-whitelist.json",
} as const;
export type FactorioList = keyof typeof LIST_FILES;

/** A factorio.com username, as the game allows them; nothing else can reach a console command. */
export function playerName(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,60}$/.test(value)) throw new Error("Choose a player by their Factorio username: letters, digits, _, . and -");
    return value;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface FactorioBan { name: string; reason: string }

/** A ban as the file holds it: a bare name, or `{ username, reason }`. */
function banOf(entry: unknown): FactorioBan {
    if (typeof entry === "string") return { name: entry, reason: "" };
    if (entry && typeof entry === "object" && typeof (entry as { username?: unknown }).username === "string") {
        const { username, reason } = entry as { username: string; reason?: unknown };
        return { name: username, reason: typeof reason === "string" ? reason : "" };
    }
    throw new Error(`${LIST_FILES.bans} holds an entry that is not a player`);
}

/** A player Paperboard has seen on the server. */
export interface FactorioSeen { name: string; lastSeen: number }

export class FactorioLists {
    // the files' read-modify-writes, one at a time
    private readonly serial = new SerialQueue().run;
    constructor(private readonly root: string, private readonly dataDir: string) {}

    file(list: FactorioList) { return path.join(this.dataDir, LIST_FILES[list]); }
    private get seenFile() { return path.join(this.root, "factorio-players.json"); }

    private async entries(list: FactorioList): Promise<unknown[]> {
        const text = await unlessMissing(fs.readFile(this.file(list), "utf8"), null);
        if (text === null || !text.trim()) return [];
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error(`${LIST_FILES[list]} is not a list`);
        return parsed;
    }

    async names(list: Exclude<FactorioList, "bans">): Promise<string[]> {
        const entries = await this.entries(list);
        if (!entries.every((e) => typeof e === "string")) throw new Error(`${LIST_FILES[list]} holds an entry that is not a player`);
        return entries as string[];
    }
    async bans(): Promise<FactorioBan[]> {
        return (await this.entries("bans")).map(banOf);
    }

    /** Puts a player on a list or takes them off, in the file; for a stopped server. */
    set(list: FactorioList, name: string, on: boolean, reason = ""): Promise<void> {
        return this.serial(async () => {
            const entries = await this.entries(list);
            const nameOf = (e: unknown) => (list === "bans" ? banOf(e).name : String(e));
            const kept = entries.filter((e) => !same(nameOf(e), name));
            // the game writes each name in lower case, and matches them so
            if (on) kept.push(list === "bans" ? { username: name.toLowerCase(), reason } : name.toLowerCase());
            await fs.mkdir(this.dataDir, { recursive: true });
            await writeFileAtomic(this.file(list), `${JSON.stringify(kept, null, 2)}\n`);
        });
    }

    async seen(): Promise<FactorioSeen[]> {
        const text = await unlessMissing(fs.readFile(this.seenFile, "utf8"), null);
        if (text === null) return [];
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error("factorio-players.json is not a list");
        return parsed as FactorioSeen[];
    }

    /** Records players who are on. */
    remember(names: readonly string[], now = Date.now()): Promise<void> {
        if (names.length === 0) return Promise.resolve();
        return this.serial(async () => {
            const byName = new Map((await this.seen()).map((p) => [p.name.toLowerCase(), p]));
            for (const name of names) byName.set(name.toLowerCase(), { name, lastSeen: now });
            await writeFileAtomic(this.seenFile, JSON.stringify([...byName.values()], null, 2));
        });
    }
}

/** The names in `/players online`'s answer: "Online players (2):" then a line for each, "  alice (online)". */
export function parseOnline(reply: string): string[] {
    const lines = reply.split(/\r?\n/);
    if (!/^Online players \(\d+\):$/.test(lines[0]?.trim() ?? "")) throw new Error(`Factorio answered /players online with something else: ${reply.trim().slice(0, 200)}`);
    return lines.slice(1).map((line) => /^\s+(\S+)(?: \(online\))?\s*$/.exec(line)?.[1]).filter((name): name is string => Boolean(name));
}
