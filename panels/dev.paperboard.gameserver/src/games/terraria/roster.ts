// Terraria's players as its dedicated server shows them: console lines,
// the banlist it re-reads on every connection, and the roster Paperboard
// keeps of everyone who has joined. Formats are Terraria 1.4.5.8's.
import fs from "node:fs/promises";
import path from "node:path";

export type ConsoleEvent =
    | { kind: "join"; name: string }
    | { kind: "leave"; name: string }
    | { kind: "chat"; sender: string; content: string }
    | { kind: "server"; content: string }
    /** one row of the `playing` command's answer */
    | { kind: "listed"; name: string; address: string }
    /** the line that ends the `playing` command's answer */
    | { kind: "count"; count: number };

/** The console's ": " prompt is printed without a newline, so it often starts the next line. */
export function stripPrompt(line: string): string {
    return line.replace(/\r/g, "").replace(/^(?:: )+/, "");
}

export function parseConsoleLine(line: string): ConsoleEvent | null {
    const text = stripPrompt(line);
    let m = text.match(/^(.+) has joined\.$/);
    if (m) return { kind: "join", name: m[1] };
    m = text.match(/^(.+) has left\.$/);
    if (m) return { kind: "leave", name: m[1] };
    m = text.match(/^<([^>]+)> (.*)$/);
    if (m) return m[1] === "Server" ? { kind: "server", content: m[2] } : { kind: "chat", sender: m[1], content: m[2] };
    m = text.match(/^(.+) \(([0-9a-fA-F.:[\]]+:\d+)\)$/);
    if (m) return { kind: "listed", name: m[1], address: m[2] };
    if (text === "No players connected.") return { kind: "count", count: 0 };
    m = text.match(/^(\d+) players? connected\.$/);
    if (m) return { kind: "count", count: Number(m[1]) };
    return null;
}

/** "127.0.0.1:53208" → "127.0.0.1", the form Terraria bans by */
export function hostOf(address: string): string {
    const at = address.lastIndexOf(":");
    if (at <= 0) throw new Error(`Not a player address: ${address}`);
    return address.slice(0, at).replace(/^\[(.*)\]$/, "$1");
}

/** Terraria names are one line of at most 20 characters; kick and ban take the rest of the line. */
export function playerName(input: unknown): string {
    if (typeof input !== "string" || !input.trim()) throw new Error("Choose a player");
    if (/[\r\n]/.test(input) || input.length > 20) throw new Error("Terraria player names are one line of up to 20 characters");
    return input;
}

export interface BanEntry { name: string; address: string }

/** banlist.txt holds "//Name" then the banned address, one pair per ban. */
export function parseBanlist(text: string): BanEntry[] {
    const lines = text.split(/\r?\n/);
    const bans: BanEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith("//")) {
            const address = lines[i + 1]?.trim() ?? "";
            if (address && !address.startsWith("//")) { bans.push({ name: line.slice(2), address }); i++; }
            continue;
        }
        bans.push({ name: "", address: line });
    }
    return bans;
}

export function formatBanlist(bans: readonly BanEntry[]): string {
    return bans.map((ban) => ban.name ? `//${ban.name}\n${ban.address}\n` : `${ban.address}\n`).join("");
}

export interface SeenPlayer { name: string; lastSeen: number; address?: string }

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// read-modify-write of one file at a time: two joins at once must not drop a sighting
const queues = new Map<string, Promise<unknown>>();
function serial<T>(file: string, work: () => Promise<T>): Promise<T> {
    const next = (queues.get(file) ?? Promise.resolve()).then(work, work);
    // the caller gets the failure from `next`; the queue only waits for it to settle
    queues.set(file, Promise.allSettled([next]));
    return next;
}

export class PlayerStore {
    constructor(private readonly root: string) {}
    private get seenFile() { return path.join(this.root, "players.json"); }
    private get banFile() { return path.join(this.root, "banlist.txt"); }

    /** Waits for any sighting still being written. */
    seen(): Promise<SeenPlayer[]> {
        return serial(this.seenFile, () => this.readSeen());
    }

    private async readSeen(): Promise<SeenPlayer[]> {
        let text: string;
        try { text = await fs.readFile(this.seenFile, "utf8"); } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw err;
        }
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed) || parsed.some((p) => typeof p?.name !== "string" || typeof p?.lastSeen !== "number")) {
            throw new Error("players.json is damaged; fix or remove it in Files");
        }
        return parsed as SeenPlayer[];
    }

    /** Records a sighting; an address is kept until a newer one is seen. */
    remember(name: string, address?: string): Promise<void> {
        return serial(this.seenFile, async () => {
            const players = await this.readSeen();
            const previous = players.find((p) => sameName(p.name, name));
            const next: SeenPlayer = { name, lastSeen: Date.now(), address: address ?? previous?.address };
            const rest = players.filter((p) => p !== previous);
            await this.writeAtomic(this.seenFile, `${JSON.stringify([...rest, next], null, 2)}\n`);
        });
    }

    bans(): Promise<BanEntry[]> {
        return serial(this.banFile, () => this.readBans());
    }

    private async readBans(): Promise<BanEntry[]> {
        try { return parseBanlist(await fs.readFile(this.banFile, "utf8")); } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw err;
        }
    }

    /** Bans a player who is not online by the last address they joined from. */
    banOffline(name: string): Promise<void> {
        return serial(this.banFile, async () => {
            const player = (await this.readSeen()).find((p) => sameName(p.name, name));
            if (!player) throw new Error(`${name} has never joined this server`);
            if (!player.address) throw new Error(`Paperboard has no address for ${player.name} yet; ban them while they are online`);
            const address = hostOf(player.address);
            const bans = await this.readBans();
            if (bans.some((ban) => ban.address === address)) throw new Error(`${player.name}'s address is already banned`);
            await this.writeAtomic(this.banFile, formatBanlist([...bans, { name: player.name, address }]));
        });
    }

    /** Lifts every ban recorded under this name. */
    unban(name: string): Promise<void> {
        return serial(this.banFile, async () => {
            const bans = await this.readBans();
            const kept = bans.filter((ban) => !sameName(ban.name, name));
            if (kept.length === bans.length) throw new Error(`${name} is not banned`);
            await this.writeAtomic(this.banFile, formatBanlist(kept));
        });
    }

    private async writeAtomic(file: string, text: string): Promise<void> {
        const temp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temp, text);
        await fs.rename(temp, file);
    }
}
