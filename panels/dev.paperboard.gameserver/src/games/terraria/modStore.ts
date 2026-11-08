import fs from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { trashDirName } from "../../service/trash";
import { downloadWorkshopItems, discardWorkshopItems, type Runner } from "../steam/steamcmd";
import { workshopItems, type WorkshopItem } from "../steam/modscan";

// A tModLoader server's mods: .tmod files in tModLoader/Mods, the names
// enabled.json turns on, and what Paperboard knows about where each came
// from. tModLoader reads both files only when it starts, so every change
// applies on the next start. Workshop mods arrive through SteamCMD; the
// Workshop folder layout is never used to run them: the right build is
// copied into Mods, so a server loads the same way however a mod arrived.

export const TMODLOADER_APP_ID = 1281930;
/** the -tmlsavedirectory, below the server folder */
export const SAVE_DIR = "tModLoader";
export const MODS_DIR = `${SAVE_DIR}/Mods`;
const RECORDS = `${SAVE_DIR}/paperboard-mods.json`;

export interface TmodInfo {
    /** the mod's internal name, what enabled.json and other mods' references use */
    name: string;
    version: string;
    /** the tModLoader version it was built with */
    builtFor: string;
    displayName: string;
    /** required mods' internal names */
    references: string[];
}

/** Where a mod file came from. Absent for a file put in Mods by hand. */
export interface ModRecord {
    workshopId?: string;
    title: string;
    previewImageUrl?: string | null;
    timeUpdated?: number;
    uploaded?: boolean;
}

export interface InstalledMod {
    file: string;
    info: TmodInfo | null;
    /** why the file could not be read as a mod */
    problem?: string;
    enabled: boolean;
    record?: ModRecord;
}

class Reader {
    offset = 0;
    constructor(readonly bytes: Uint8Array, readonly what: string) {}
    need(n: number) { if (this.offset + n > this.bytes.length) throw new RangeError(`${this.what} ends early`); }
    byte() { this.need(1); return this.bytes[this.offset++]!; }
    int32() { this.need(4); const v = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getInt32(0, true); this.offset += 4; return v; }
    skip(n: number) { this.need(n); this.offset += n; }
    /** .NET BinaryWriter: a 7-bit encoded length, then UTF-8 */
    string() {
        let length = 0;
        for (let shift = 0; ; shift += 7) {
            if (shift > 28) throw new Error(`${this.what} has a malformed string`);
            const b = this.byte();
            length |= (b & 0x7f) << shift;
            if (b < 0x80) break;
        }
        this.need(length);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(this.offset, this.offset + length));
        this.offset += length;
        return text;
    }
}

const LIST_TAGS = new Set(["dllReferences", "modReferences", "weakReferences", "sortAfter", "sortBefore"]);
const STRING_TAGS = new Set(["author", "version", "displayName", "homepage", "description", "modSource", "eacPath", "translationMod", "buildVersion"]);
const FLAG_TAGS = new Set(["noCompile", "!playableOnPreview", "!hideCode", "!hideResources", "includeSource"]);

/**
 * tModLoader's BuildProperties: tags, each followed by its value, ending with
 * an empty tag. Lists come first when written, so a later tag this reader
 * does not know ends the read without losing the references.
 */
export function readBuildProperties(bytes: Uint8Array): { references: string[]; displayName?: string } {
    const r = new Reader(bytes, "The mod's Info");
    const out: { references: string[]; displayName?: string } = { references: [] };
    for (let tag = r.string(); tag.length > 0; tag = r.offset < bytes.length ? r.string() : "") {
        if (LIST_TAGS.has(tag)) {
            const items: string[] = [];
            for (let item = r.string(); item.length > 0; item = r.string()) items.push(item);
            if (tag === "modReferences") out.references = items.map(ref => ref.split("@")[0]!.trim()).filter(Boolean);
        } else if (STRING_TAGS.has(tag)) {
            const value = r.string();
            if (tag === "displayName") out.displayName = value;
        } else if (tag === "side") r.byte();
        else if (!FLAG_TAGS.has(tag)) break;
    }
    return out;
}

const NAME = /^[A-Za-z0-9_]{1,128}$/;

/** Reads a .tmod's header, file table and Info without loading the whole file. */
export async function readTmod(file: string): Promise<TmodInfo> {
    const handle = await fs.open(file, "r");
    try {
        const { size } = await handle.stat();
        let head = new Uint8Array(0);
        // the header and file table, read in growing chunks: big mods list thousands of files
        for (let want = 64 * 1024; ; want *= 4) {
            const length = Math.min(want, size);
            head = new Uint8Array(length);
            await handle.read(head, 0, length, 0);
            try {
                return await parse(head, size, async (offset, length) => {
                    const out = new Uint8Array(length);
                    const { bytesRead } = await handle.read(out, 0, length, offset);
                    if (bytesRead !== length) throw new Error("The mod file ends early");
                    return out;
                });
            } catch (err) {
                if (err instanceof RangeError && length < size) continue;
                throw err instanceof RangeError ? new Error(`Not a tModLoader mod: ${err.message}`) : err;
            }
        }
    } finally {
        await handle.close();
    }
}

async function parse(head: Uint8Array, size: number, read: (offset: number, length: number) => Promise<Uint8Array>): Promise<TmodInfo> {
    const r = new Reader(head, "The mod file");
    r.need(4);
    if (new TextDecoder().decode(head.subarray(0, 4)) !== "TMOD") throw new Error("Not a tModLoader mod: the file does not start with TMOD");
    r.skip(4);
    const builtFor = r.string();
    if (!/^\d+(\.\d+){1,3}$/.test(builtFor)) throw new Error(`Not a tModLoader mod: unknown format ${builtFor}`);
    r.skip(20 + 256); // hash, signature
    const dataLength = r.int32();
    if (dataLength !== size - r.offset) throw new Error("Not a tModLoader mod: its size does not match its header");
    const name = r.string();
    const version = r.string();
    if (!NAME.test(name)) throw new Error(`Not a tModLoader mod: invalid internal name ${JSON.stringify(name)}`);
    const count = r.int32();
    if (count < 0 || count > 1_000_000) throw new Error("Not a tModLoader mod: invalid file table");
    let info: { length: number; compressed: number; at: number } | null = null;
    let at = 0;
    const entries: { name: string; length: number; compressed: number }[] = [];
    for (let i = 0; i < count; i++) {
        const entry = { name: r.string(), length: r.int32(), compressed: r.int32() };
        if (entry.length < 0 || entry.compressed < 0) throw new Error("Not a tModLoader mod: invalid file table");
        entries.push(entry);
    }
    const dataStart = r.offset;
    for (const entry of entries) {
        if (entry.name === "Info") info = { length: entry.length, compressed: entry.compressed, at: dataStart + at };
        at += entry.compressed;
    }
    if (dataStart + at !== size) throw new Error("Not a tModLoader mod: its files do not fill it");
    if (!info) throw new Error(`${name} has no Info, so its requirements can't be read`);
    const stored = await read(info.at, info.compressed);
    const raw = info.length === info.compressed ? stored : inflateRawSync(stored);
    const props = readBuildProperties(raw);
    return { name, version, builtFor, displayName: props.displayName || name, references: props.references };
}

/** "2026.08.3.0" → [2026, 8, 3, 0]; a folder like "2026.3" compares on its two parts. */
const parts = (version: string) => version.split(".").map(n => Number.parseInt(n, 10));
export function compareVersions(a: string, b: string): number {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

/**
 * The build in a downloaded Workshop item that this tModLoader loads: the
 * newest version folder not newer than the server (tModLoader's own rule),
 * or the item's root for one with a single build.
 */
export async function pickBuild(folder: string, tmodloaderVersion: string): Promise<string> {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const server = parts(tmodloaderVersion).slice(0, 2).join(".");
    const versions = entries.filter(e => e.isDirectory() && /^\d{4}\.\d{1,2}$/.test(e.name)).map(e => e.name).filter(v => compareVersions(v, server) <= 0).sort(compareVersions);
    const candidates = versions.length > 0 ? [path.join(folder, versions.at(-1)!)] : [folder];
    for (const dir of candidates) {
        const tmods = (await fs.readdir(dir)).filter(f => f.endsWith(".tmod"));
        if (tmods.length === 1) return path.join(dir, tmods[0]!);
        if (tmods.length > 1) throw new Error(`The Workshop item has more than one mod file in ${path.basename(dir)}`);
    }
    throw new Error(`The Workshop item has no build for tModLoader ${tmodloaderVersion}`);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
    let text: string;
    try { text = await fs.readFile(file, "utf8"); } catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw err; }
    try { return JSON.parse(text) as T; } catch { throw new Error(`${path.basename(file)} is not valid JSON; fix or remove it in Files`); }
}
async function writeJson(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2));
    await fs.rename(temp, file);
}

export interface ModStoreDeps {
    root: string;
    tmodloaderVersion: string;
    runner?: Runner;
    /** SteamCMD's folder; the panel's own when absent */
    steamWorkspace?: string;
    modscanBase?: string;
    onLine?: (line: string) => void;
}

export class ModStore {
    constructor(readonly deps: ModStoreDeps) {}
    private get dir() { return path.join(this.deps.root, MODS_DIR); }
    private async enabled(): Promise<string[]> {
        const list = await readJson<unknown>(path.join(this.dir, "enabled.json"), []);
        if (!Array.isArray(list) || list.some(n => typeof n !== "string")) throw new Error("enabled.json is not a list of mod names; fix or remove it in Files");
        return list as string[];
    }
    private setEnabled(names: string[]) { return writeJson(path.join(this.dir, "enabled.json"), [...new Set(names)]); }
    private async records(): Promise<Record<string, ModRecord>> {
        const value = await readJson<unknown>(path.join(this.deps.root, RECORDS), {});
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("paperboard-mods.json is not a record of mods; remove it in Files");
        return value as Record<string, ModRecord>;
    }
    private setRecords(records: Record<string, ModRecord>) { return writeJson(path.join(this.deps.root, RECORDS), records); }

    async list(): Promise<InstalledMod[]> {
        let files: string[];
        try { files = (await fs.readdir(this.dir)).filter(f => f.endsWith(".tmod")).sort((a, b) => a.localeCompare(b)); }
        catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; throw err; }
        const [enabled, records] = await Promise.all([this.enabled(), this.records()]);
        return Promise.all(files.map(async (file): Promise<InstalledMod> => {
            try {
                const info = await readTmod(path.join(this.dir, file));
                return { file, info, enabled: enabled.includes(info.name), record: records[file] };
            } catch (err) {
                return { file, info: null, problem: err instanceof Error ? err.message : String(err), enabled: false, record: records[file] };
            }
        }));
    }

    /** checks a build loads on this tModLoader */
    private compatible(info: TmodInfo, title: string) {
        if (compareVersions(info.builtFor, this.deps.tmodloaderVersion) > 0) throw new Error(`${title} was built for tModLoader ${info.builtFor}, newer than this server's ${this.deps.tmodloaderVersion}`);
    }

    /**
     * Copies checked mod files into Mods and turns them on, all or nothing:
     * a mod whose required mods would be missing stops the whole change.
     */
    private async place(incoming: { source: string; info: TmodInfo; record: ModRecord }[]) {
        const installed = await this.list();
        const after = new Map(installed.filter(m => m.info).map(m => [m.info!.name, m.info!]));
        for (const mod of incoming) after.set(mod.info.name, mod.info);
        for (const mod of incoming) {
            const missing = mod.info.references.filter(name => !after.has(name));
            if (missing.length) throw new Error(`${mod.record.title} needs ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} installed. Install ${missing.length === 1 ? "it" : "them"} first.`);
        }
        await fs.mkdir(this.dir, { recursive: true });
        const records = await this.records();
        const enabled = await this.enabled();
        for (const mod of incoming) {
            const file = `${mod.info.name}.tmod`;
            // a different file already holding this mod is replaced, not left to clash
            for (const old of installed) if (old.info?.name === mod.info.name && old.file !== file) { await this.trash(old.file); delete records[old.file]; }
            const temp = path.join(this.dir, `.${file}.${process.pid}.tmp`);
            await fs.copyFile(mod.source, temp);
            await fs.rename(temp, path.join(this.dir, file));
            records[file] = mod.record;
            enabled.push(mod.info.name);
        }
        await this.setRecords(records);
        await this.setEnabled(enabled);
    }

    private async trash(file: string) {
        const trash = path.join(this.deps.root, trashDirName(), MODS_DIR);
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(path.join(this.dir, file), path.join(trash, file));
    }

    /** Downloads Workshop items through SteamCMD and installs the build each has for this server. */
    async installWorkshop(items: readonly { id: string; title: string; previewImageUrl?: string | null; timeUpdated?: number }[]): Promise<string[]> {
        const ids = items.map(i => i.id);
        const folders = await downloadWorkshopItems(TMODLOADER_APP_ID, ids, { runner: this.deps.runner, onLine: this.deps.onLine, workspace: this.deps.steamWorkspace });
        try {
            const incoming = [];
            for (const item of items) {
                const source = await pickBuild(folders.get(item.id)!, this.deps.tmodloaderVersion);
                const info = await readTmod(source);
                this.compatible(info, item.title);
                incoming.push({ source, info, record: { workshopId: item.id, title: item.title, previewImageUrl: item.previewImageUrl ?? null, timeUpdated: item.timeUpdated } });
            }
            await this.place(incoming);
            return incoming.map(m => m.record.title);
        } finally {
            await discardWorkshopItems(TMODLOADER_APP_ID, ids, this.deps.steamWorkspace);
        }
    }

    /**
     * Installs one Workshop mod and every item it requires that this server
     * lacks, following what those require in turn.
     */
    async install(id: string, dependencies: readonly string[] = []): Promise<string[]> {
        const records = await this.records();
        const have = new Set(Object.values(records).flatMap(r => (r.workshopId ? [r.workshopId] : [])));
        const byId = new Map<string, WorkshopItem>();
        let next = [id, ...dependencies.filter(d => d !== id && !have.has(d))];
        // a chain deeper than this is a loop or not a dependency list
        for (let round = 0; next.length > 0; round++) {
            if (round === 8 || byId.size + next.length > 100) throw new Error("This mod's requirements go deeper than Paperboard follows; install them one by one");
            const { items } = await workshopItems("tmodloader", next, { base: this.deps.modscanBase });
            for (const item of items) byId.set(item.id, item);
            const missing = next.filter(w => !byId.has(w));
            if (missing.length) throw new Error(`Steam Workshop has no public item ${missing.join(", ")}`);
            next = [...new Set(items.flatMap(i => i.children ?? []))].filter(c => !byId.has(c) && !have.has(c));
        }
        return this.installWorkshop([...byId.values()].map(i => ({ id: i.id, title: i.title, previewImageUrl: i.previewImageUrl, timeUpdated: i.timeUpdated })));
    }

    /** Re-downloads every Workshop mod Steam has a newer upload of. */
    async update(): Promise<{ updated: string[]; current: number }> {
        const records = Object.values(await this.records()).filter(r => r.workshopId);
        if (records.length === 0) return { updated: [], current: 0 };
        const { items } = await workshopItems("tmodloader", records.map(r => r.workshopId!), { base: this.deps.modscanBase });
        const latest = new Map(items.map(i => [i.id, i]));
        const gone = records.filter(r => !latest.has(r.workshopId!));
        if (gone.length) throw new Error(`Steam Workshop no longer lists ${gone.map(r => r.title).join(", ")}; uninstall ${gone.length === 1 ? "it" : "them"} or upload a file by hand`);
        const stale: WorkshopItem[] = records.map(r => latest.get(r.workshopId!)!).filter((item, i) => item.timeUpdated !== records[i]!.timeUpdated);
        if (stale.length === 0) return { updated: [], current: records.length };
        const updated = await this.installWorkshop(stale.map(i => ({ id: i.id, title: i.title, previewImageUrl: i.previewImageUrl, timeUpdated: i.timeUpdated })));
        return { updated, current: records.length - stale.length };
    }

    /** Moves a mod file to the server's trash and turns it off. Mods needing it are named and stop the removal. */
    async remove(file: string): Promise<void> {
        if (!/^[^/\\]+\.tmod$/.test(file)) throw new Error("Choose a .tmod file in Mods");
        const mods = await this.list();
        const target = mods.find(m => m.file === file);
        if (!target) throw new Error(`${file} is not in Mods`);
        const dependents = target.info ? mods.filter(m => m.file !== file && m.info?.references.includes(target.info!.name)) : [];
        if (dependents.length) throw new Error(`${dependents.map(m => m.record?.title ?? m.info!.displayName).join(", ")} ${dependents.length === 1 ? "needs" : "need"} ${target.record?.title ?? target.info!.displayName}. Uninstall ${dependents.length === 1 ? "it" : "them"} first.`);
        await this.trash(file);
        const records = await this.records();
        delete records[file];
        await this.setRecords(records);
        if (target.info) await this.setEnabled((await this.enabled()).filter(n => n !== target.info!.name));
    }

    /** Adds .tmod files the user staged; the staging folder is always removed. */
    async upload(stageDir: string): Promise<string[]> {
        try {
            let names: string[];
            // sorted: the disk's own order differs between filesystems, and
            // the error below should read the same everywhere
            try { names = (await fs.readdir(stageDir)).sort((a, b) => a.localeCompare(b)); } catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Nothing was uploaded. Choose the files again."); throw err; }
            if (names.length === 0) throw new Error("Nothing was uploaded. Choose the files again.");
            const incoming = [];
            const problems: string[] = [];
            for (const name of names) {
                const source = path.join(stageDir, name);
                try {
                    if (!name.endsWith(".tmod")) throw new Error("is not a .tmod file");
                    const info = await readTmod(source);
                    this.compatible(info, name);
                    incoming.push({ source, info, record: { title: info.displayName, uploaded: true } });
                } catch (err) {
                    problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            if (problems.length) throw new Error(`Nothing was added. ${problems.join(" ")}`);
            await this.place(incoming);
            return incoming.map(m => m.info.displayName);
        } finally {
            await fs.rm(stageDir, { recursive: true, force: true });
        }
    }
}
