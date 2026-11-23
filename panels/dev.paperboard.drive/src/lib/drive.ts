// The drive itself: a folder on this computer, and everything done to what
// is in it. Every path that comes in is relative to the drive's top and is
// checked here before it touches the disk: no "..", no absolute paths, no
// odd names, and nothing that resolves outside the drive through a link.
//
// Uploads arrive in pieces into a hidden folder beside the drive, so a
// half-sent file is never in the drive, and land under their name only once
// whole, beside any file already called that ("photo 2.jpg"). That folder is
// emptied when the service starts: what is in it then was left by a stop.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";
import { baseOf, CHUNK_BYTES, joinPath, parentOf, type DriveEntry } from "./contract";

/** A name's most bytes, as most filesystems allow. */
export const NAME_BYTES = 255;
/** An upload nothing is sent to for this long is dropped. */
export const UPLOAD_IDLE_MS = 10 * 60_000;
/** The most uploads under way at once. */
export const UPLOADS_AT_ONCE = 32;
/** The most text a block reads from a file. */
export const TEXT_READ_BYTES = 4 * 1024 * 1024;

interface Upload {
    folder: string;
    name: string;
    size: number;
    written: number;
    part: string;
    handle: fs.promises.FileHandle;
    idle: ReturnType<typeof setTimeout>;
    /** one piece at a time: a piece that came early waits for the one before */
    busy: Promise<void>;
}

/** Why a name can't be used, or null when it can. */
export function nameProblem(name: unknown): string | null {
    if (typeof name !== "string" || name.trim() === "") return "A name can't be empty.";
    if (name === "." || name === "..") return `“${name}” can't be a name.`;
    if (name.includes("/") || name.includes("\\")) return "A name can't have “/” or “\\” in it.";
    if (name.includes("\0")) return "A name can't have a null character in it.";
    if (/[\x00-\x1f\x7f]/.test(name)) return "A name can't have control characters in it.";
    if (Buffer.byteLength(name, "utf8") > NAME_BYTES) return `A name can be at most ${NAME_BYTES} bytes long.`;
    return null;
}

function checkName(name: unknown): string {
    const problem = nameProblem(name);
    if (problem) throw new Error(problem);
    return name as string;
}

/** A path's parts, checked; [] for the drive's top (""). */
export function pathParts(rel: unknown): string[] {
    if (typeof rel !== "string") throw new Error("A path is text.");
    if (rel === "") return [];
    if (rel.includes("\0")) throw new Error("A path can't have a null character in it.");
    if (rel.startsWith("/") || rel.startsWith("\\") || /^[a-zA-Z]:/.test(rel)) throw new Error(`“${rel}” isn't a path in the drive.`);
    const parts = rel.split("/");
    for (const part of parts) {
        if (part === "" || part === "." || part === "..") throw new Error(`“${rel}” isn't a path in the drive.`);
        const problem = nameProblem(part);
        if (problem) throw new Error(`“${rel}” isn't a path in the drive: ${problem}`);
    }
    return parts;
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";

/** "photo.jpg", then "photo 2.jpg", "photo 3.jpg"; a folder or a dotfile counts on its whole name. */
export function numberedName(name: string, n: number): string {
    if (n < 2) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
}

export class Drive {
    private uploads = new Map<string, Upload>();
    private realRoot = "";

    /**
     * `root`: the drive's folder; `temp`: a folder of its own beside it, on
     * the same disk, where uploads are written until they're whole.
     */
    constructor(
        readonly root: string,
        private readonly temp: string,
    ) {}

    /** Makes the drive's folders, and drops what uploads a stop left behind. */
    async open(): Promise<void> {
        await fs.promises.mkdir(this.root, { recursive: true });
        this.realRoot = await fs.promises.realpath(this.root);
        await fs.promises.rm(this.temp, { recursive: true, force: true });
        await fs.promises.mkdir(this.temp, { recursive: true });
    }

    /** Ends every upload under way, removing what they wrote. */
    async close(): Promise<void> {
        await Promise.all([...this.uploads.keys()].map((id) => this.drop(id)));
    }

    // ---------------------------------------------------------------- paths

    private inside(real: string): boolean {
        return real === this.realRoot || real.startsWith(this.realRoot + path.sep);
    }

    /** Where a path in the drive is on disk, once it's checked: it must exist, and be in the drive through any links. */
    private async existing(rel: unknown): Promise<string> {
        if (!this.realRoot) throw new Error("The drive isn't open yet.");
        const parts = pathParts(rel);
        const full = path.join(this.root, ...parts);
        let real: string;
        try {
            real = await fs.promises.realpath(full);
        } catch (err) {
            if (isMissing(err)) throw new Error(`“${rel === "" ? "Drive" : rel}” isn't in the drive.`);
            throw err;
        }
        if (!this.inside(real)) throw new Error(`“${rel}” leads outside the drive.`);
        return full;
    }

    /** A folder in the drive, checked. */
    private async folder(rel: unknown): Promise<string> {
        const full = await this.existing(rel);
        if (!(await fs.promises.stat(full)).isDirectory()) throw new Error(`“${rel}” isn't a folder.`);
        return full;
    }

    /** A file or folder that may be changed: in the drive, and not the drive itself. */
    private async item(rel: unknown): Promise<{ rel: string; full: string }> {
        if (rel === "") throw new Error("That's the whole drive.");
        const full = await this.existing(rel);
        return { rel: rel as string, full };
    }

    private async entry(rel: string, full: string): Promise<DriveEntry> {
        const st = await fs.promises.stat(full);
        if (st.isDirectory()) {
            const count = (await fs.promises.readdir(full)).length;
            return { name: baseOf(rel), path: rel, kind: "folder", size: 0, modified: st.mtimeMs, count };
        }
        return { name: baseOf(rel), path: rel, kind: "file", size: st.size, modified: st.mtimeMs };
    }

    /** Anything there, a broken link included: existsSync follows links, and a rename would replace one it called free. */
    private taken(folderFull: string, name: string): boolean {
        return fs.lstatSync(path.join(folderFull, name), { throwIfNoEntry: false }) !== undefined;
    }

    // ---------------------------------------------------------------- reading

    async list(folder: unknown): Promise<DriveEntry[]> {
        const full = await this.folder(folder);
        const names = await fs.promises.readdir(full);
        const entries = await Promise.all(
            names.map(async (name): Promise<DriveEntry | null> => {
                // a name no path can carry (one with a "\\" or a newline, made outside the drive) can't be opened or changed here
                if (nameProblem(name)) return null;
                const rel = joinPath(folder as string, name);
                const child = path.join(full, name);
                try {
                    const real = await fs.promises.realpath(child);
                    // a link that leads out of the drive isn't part of it, so it isn't shown
                    if (!this.inside(real)) return null;
                    return await this.entry(rel, child);
                } catch (err) {
                    // a link to nothing, or a file deleted while listing: not there to show
                    if (isMissing(err)) return null;
                    throw err;
                }
            }),
        );
        return entries.filter((e): e is DriveEntry => e !== null);
    }

    async stat(rel: unknown): Promise<DriveEntry> {
        const { full } = await this.item(rel);
        return this.entry(rel as string, full);
    }

    /** A piece of a file, up to CHUNK_BYTES from `offset`. */
    async read(rel: unknown, offset: unknown): Promise<{ data: Buffer; size: number; modified: number }> {
        const { full } = await this.item(rel);
        const st = await fs.promises.stat(full);
        if (!st.isFile()) throw new Error(`“${rel}” isn't a file.`);
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > st.size) throw new Error("That's not a place in the file.");
        const handle = await fs.promises.open(full, "r");
        try {
            const data = Buffer.alloc(Math.min(CHUNK_BYTES, st.size - offset));
            const { bytesRead } = await handle.read(data, 0, data.length, offset);
            return { data: data.subarray(0, bytesRead), size: st.size, modified: st.mtimeMs };
        } finally {
            await handle.close();
        }
    }

    /** A file's text, for a block: UTF-8, and at most TEXT_READ_BYTES. */
    async readText(rel: unknown): Promise<string> {
        const { full } = await this.item(rel);
        const st = await fs.promises.stat(full);
        if (!st.isFile()) throw new Error(`“${rel}” isn't a file.`);
        if (st.size > TEXT_READ_BYTES) throw new Error(`“${rel}” is over ${TEXT_READ_BYTES / 1024 / 1024} MB, more text than a block reads.`);
        const data = await fs.promises.readFile(full);
        if (data.includes(0) || !Buffer.from(data.toString("utf8"), "utf8").equals(data)) throw new Error(`“${rel}” isn't a text file.`);
        return data.toString("utf8");
    }

    // ---------------------------------------------------------------- changing

    async createFolder(folder: unknown, name: unknown): Promise<DriveEntry> {
        const parent = await this.folder(folder);
        const clean = checkName(name);
        if (this.taken(parent, clean)) throw new Error(`There's already something called “${clean}” here.`);
        const full = path.join(parent, clean);
        await fs.promises.mkdir(full);
        return this.entry(joinPath(folder as string, clean), full);
    }

    async rename(rel: unknown, name: unknown): Promise<DriveEntry> {
        const { full } = await this.item(rel);
        const clean = checkName(name);
        if (clean === baseOf(rel as string)) return this.entry(rel as string, full);
        const target = path.join(path.dirname(full), clean);
        // a disk that ignores case finds the new name already there when only
        // the case changes; that is allowed only when it is the same file
        const there = fs.lstatSync(target, { throwIfNoEntry: false });
        if (there) {
            const self = fs.lstatSync(full);
            if (there.dev !== self.dev || there.ino !== self.ino) throw new Error(`There's already something called “${clean}” here.`);
        }
        fs.renameSync(full, target);
        return this.entry(joinPath(parentOf(rel as string), clean), target);
    }

    /** Moves each into `folder`; a folder can't go into itself, and a name already there is refused before anything moves. */
    async move(paths: unknown, folder: unknown): Promise<DriveEntry[]> {
        if (!Array.isArray(paths) || paths.length === 0) throw new Error("Nothing to move.");
        const into = await this.folder(folder);
        const items = await Promise.all(paths.map((p) => this.item(p)));
        // from here to the last rename nothing awaits, so no other call can
        // put a file at a name these checks found free
        const names = new Set<string>();
        for (const item of items) {
            const name = baseOf(item.rel);
            if (folder === item.rel || (folder as string).startsWith(`${item.rel}/`)) throw new Error(`“${name}” can't go inside itself.`);
            if (parentOf(item.rel) === folder) throw new Error(`“${name}” is already there.`);
            if (names.has(name) || this.taken(into, name)) throw new Error(`There's already something called “${name}” there.`);
            names.add(name);
        }
        const targets = items.map((item) => {
            const target = path.join(into, baseOf(item.rel));
            fs.renameSync(item.full, target);
            return { rel: joinPath(folder as string, baseOf(item.rel)), target };
        });
        return Promise.all(targets.map((t) => this.entry(t.rel, t.target)));
    }

    /** Deletes each for good; a folder goes with all it holds, a link goes as a link. */
    async delete(paths: unknown): Promise<void> {
        if (!Array.isArray(paths) || paths.length === 0) throw new Error("Nothing to delete.");
        const items = await Promise.all(paths.map((p) => this.item(p)));
        for (const item of items) await fs.promises.rm(item.full, { recursive: true, force: true });
    }

    /** Writes text to a file, replacing what it held, and makes the folders above it. */
    async writeText(rel: unknown, text: unknown): Promise<DriveEntry> {
        if (typeof text !== "string") throw new Error("The text to write is text.");
        const parts = pathParts(rel);
        if (parts.length === 0) throw new Error("A file needs a name.");
        let folder = "";
        for (const part of parts.slice(0, -1)) {
            const parent = await this.folder(folder);
            folder = joinPath(folder, part);
            if (!this.taken(parent, part)) await fs.promises.mkdir(path.join(parent, part));
        }
        const parent = await this.folder(folder);
        const full = path.join(parent, parts.at(-1)!);
        if (this.taken(parent, parts.at(-1)!)) {
            const real = await fs.promises.realpath(full);
            if (!this.inside(real)) throw new Error(`“${rel}” leads outside the drive.`);
            if ((await fs.promises.stat(full)).isDirectory()) throw new Error(`“${rel}” is a folder.`);
        }
        await writeFileAtomic(full, text);
        return this.entry(rel as string, full);
    }

    // ---------------------------------------------------------------- uploads

    async uploadBegin(folder: unknown, name: unknown, size: unknown): Promise<{ id: string }> {
        const clean = checkName(name);
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error("That's not a file's size.");
        if (this.uploads.size >= UPLOADS_AT_ONCE) throw new Error("That's a lot of files at once: wait for these to finish.");
        await this.folder(folder);
        const free = await fs.promises.statfs(this.temp);
        const room = free.bavail * free.bsize;
        if (size > room) throw new Error(`There isn't room for “${clean}”: it needs ${size} bytes, and the disk has ${room} free.`);
        const id = randomBytes(12).toString("hex");
        const part = path.join(this.temp, `${id}.part`);
        const handle = await fs.promises.open(part, "wx");
        this.uploads.set(id, { folder: folder as string, name: clean, size, written: 0, part, handle, idle: this.idleTimer(id), busy: Promise.resolve() });
        return { id };
    }

    /** The next piece, at the offset the upload has reached. */
    async uploadPut(id: unknown, offset: unknown, data: Buffer): Promise<void> {
        const upload = this.upload(id);
        const write = upload.busy.then(async () => {
            if (this.uploads.get(id as string) !== upload) throw new Error("That upload was canceled.");
            if (offset !== upload.written) throw new Error(`Expected the piece at ${upload.written}, got one at ${String(offset)}.`);
            if (data.length === 0 || data.length > CHUNK_BYTES) throw new Error(`A piece is 1 to ${CHUNK_BYTES} bytes.`);
            if (upload.written + data.length > upload.size) throw new Error("That's more than the file's size.");
            await upload.handle.write(data, 0, data.length, upload.written);
            upload.written += data.length;
            clearTimeout(upload.idle);
            upload.idle = this.idleTimer(id as string);
        });
        // the next piece waits for this one, whether it worked or not
        upload.busy = write.then(
            () => undefined,
            () => undefined,
        );
        await write;
    }

    /** The upload is whole: it lands in its folder under its name, or the first free one after it. */
    async uploadFinish(id: unknown): Promise<DriveEntry> {
        const upload = this.upload(id);
        await upload.busy;
        if (upload.written !== upload.size) throw new Error(`“${upload.name}” has ${upload.written} of its ${upload.size} bytes.`);
        this.uploads.delete(id as string);
        clearTimeout(upload.idle);
        try {
            await upload.handle.close();
            const into = await this.folder(upload.folder);
            // the name is picked and taken in one step, so two uploads of one name never land on each other
            let n = 1;
            while (this.taken(into, numberedName(upload.name, n))) n++;
            const name = numberedName(upload.name, n);
            if (Buffer.byteLength(name, "utf8") > NAME_BYTES) throw new Error(`There's no free name for “${upload.name}” here.`);
            const target = path.join(into, name);
            fs.renameSync(upload.part, target);
            return await this.entry(joinPath(upload.folder, name), target);
        } catch (err) {
            await fs.promises.rm(upload.part, { force: true });
            throw err;
        }
    }

    async uploadCancel(id: unknown): Promise<void> {
        this.upload(id);
        await this.drop(id as string);
    }

    /** The uploads under way, for tests and for the service to say how many. */
    uploading(): number {
        return this.uploads.size;
    }

    private upload(id: unknown): Upload {
        const upload = typeof id === "string" ? this.uploads.get(id) : undefined;
        if (!upload) throw new Error("That upload isn't under way.");
        return upload;
    }

    private idleTimer(id: string) {
        const timer = setTimeout(() => {
            // quiet: no one waits on an upload left idle; a part this can't remove is removed when the service next starts
            this.drop(id).catch((err) => console.error(`[drive] an idle upload's part couldn't be removed:`, err));
        }, UPLOAD_IDLE_MS);
        timer.unref?.();
        return timer;
    }

    private async drop(id: string): Promise<void> {
        const upload = this.uploads.get(id);
        if (!upload) return;
        this.uploads.delete(id);
        clearTimeout(upload.idle);
        // a write still going finishes into the part, which goes next
        await upload.busy;
        await upload.handle.close();
        await fs.promises.rm(upload.part, { force: true });
    }
}
