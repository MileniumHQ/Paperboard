import fs from "node:fs/promises";
import path from "node:path";
import { SerialQueue } from "@mileniumhq/paperapi";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";
import { unlessMissing } from "../../service/failures";
import type { ValheimPlayer } from "./log";
import { entryIs } from "./ids";

/**
 * Valheim's three lists in its save folder, one entry a line, `//` lines
 * comments. The running server reads each again within ten seconds of a
 * change (SyncedList checks the file's time as it is used), kicks a
 * banned player within five more, and turns away anyone not on a permitted
 * list that has entries. An entry is a platform id ("Steam_7656…", or the
 * bare Steam id), and the banned list may also hold a player's name.
 */
export const LISTS = {
    admin: { file: "adminlist.txt", comment: "// List admin players ID  ONE per line" },
    banned: { file: "bannedlist.txt", comment: "// List banned players ID  ONE per line" },
    permitted: { file: "permittedlist.txt", comment: "// List permitted players ID ONE per line" },
} as const;
export type ValheimList = keyof typeof LISTS;
export const isList = (value: unknown): value is ValheimList => typeof value === "string" && Object.hasOwn(LISTS, value);

/** What a list entry can be: an id, or for a ban a player's name, one line with no comment. */
export function listEntry(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value) || value.trim().startsWith("//") || value.length > 80) throw new Error("A list entry is one player's id or name");
    return value.trim();
}

/** A player Paperboard has seen join, kept beside the server's lists. */
export interface ValheimSeen extends ValheimPlayer {
    lastSeen: number;
}

export class ValheimLists {
    // the lists' read-modify-writes, one at a time
    private readonly serial = new SerialQueue().run;
    constructor(private readonly root: string, private readonly saveDir: string) {}

    private file(list: ValheimList) { return path.join(this.saveDir, LISTS[list].file); }
    private get seenFile() { return path.join(this.root, "valheim-players.json"); }

    /** The entries of a list; a list the server hasn't made yet is empty. */
    async read(list: ValheimList): Promise<string[]> {
        const text = await unlessMissing(fs.readFile(this.file(list), "utf8"), "");
        return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("//"));
    }

    /**
     * Adds the player to a list, or takes every entry that is them off it,
     * keeping the file's comments and every other entry as they are.
     */
    set(list: ValheimList, player: { name?: string; id?: string | null }, on: boolean): Promise<void> {
        return this.serial(async () => {
            const file = this.file(list);
            const text = await unlessMissing(fs.readFile(file, "utf8"), null);
            const lines = text === null ? [LISTS[list].comment] : text.split(/\r?\n/).filter((line) => line.trim());
            const kept = lines.filter((line) => line.trim().startsWith("//") || !line.trim() || !entryIs(line.trim(), player, list === "banned"));
            if (on) {
                const entry = player.id ?? (list === "banned" ? player.name : undefined);
                if (!entry) throw new Error("Valheim lists admins and permitted players by their platform id, which this player's connection never named");
                kept.push(entry);
            }
            await fs.mkdir(this.saveDir, { recursive: true });
            await writeFileAtomic(file, `${kept.join("\n")}\n`);
        });
    }

    async seen(): Promise<ValheimSeen[]> {
        const text = await unlessMissing(fs.readFile(this.seenFile, "utf8"), null);
        if (text === null) return [];
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error("valheim-players.json is not a list");
        return parsed as ValheimSeen[];
    }

    /** Records a player who joined, by their platform id. */
    remember(player: ValheimPlayer, now = Date.now()): Promise<void> {
        return this.serial(async () => {
            const byId = new Map((await this.seen()).map((p) => [p.id, p]));
            byId.set(player.id, { ...player, lastSeen: now });
            await writeFileAtomic(this.seenFile, JSON.stringify([...byId.values()], null, 2));
        });
    }
}
