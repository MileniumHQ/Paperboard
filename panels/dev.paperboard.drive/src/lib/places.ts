// The places Drive shows: its own folder, the disks plugged in, and the
// folders linked from this computer. Each is a Drive over its own root, and
// nothing is copied: a disk's files are on the disk, a folder's in the folder.
//
// Disks come and go on their own, and a linked folder stays linked while
// it's missing (a disk it's on unplugged) and says so: both are looked at
// every couple of seconds. Which folders are linked is kept in the panel's data.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";
import { OWN_PLACE, type HostFolder, type Place } from "./contract";
import { DiskReader, ejectDisk, type Disk } from "./disks";
import { Drive, type Space } from "./drive";

/** How often the disks plugged in, and the linked folders, are looked at again. */
export const POLL_MS = 2_000;
/** How often the space left on each place is read again, beside after each change. */
export const SPACE_POLL_MS = 30_000;

interface Linked {
    id: string;
    path: string;
}

interface Saved {
    folders: Linked[];
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";
const folderName = (p: string) => path.basename(p) || p;
/** Whether a folder is there; a path that leads nowhere isn't one. */
const isFolder = (p: string) =>
    fs.promises.stat(p).then(
        (st) => st.isDirectory(),
        (err: unknown) => {
            if (isMissing(err)) return false;
            throw err;
        },
    );
/** Whether `inner` is `outer` or in it. */
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);

export interface PlacesOptions {
    /** Drive's own folder, made when it's missing */
    root: string;
    /** where the linked folders are kept */
    saved: string;
    /** reads the disks plugged in; the system's, unless a test gives its own */
    disks?: { read(): Promise<Disk[]> };
    /** hears the places whenever they change */
    onChange: (places: Place[]) => void;
    /**
     * Hears a failure no one asked for (the disks couldn't be read), by what
     * it's about, and null once that works again: the panel shows it as a
     * problem until then.
     */
    onProblem: (key: string, title: string, error: unknown | null) => void;
}

const LOOK_PROBLEM = "look";
const SPACE_PROBLEM = "space";

export class Places {
    readonly own: Drive;
    private linked: Linked[] = [];
    private disks: Disk[] = [];
    private space = new Map<string, Space>();
    /** the linked folders that are there now */
    private present = new Set<string>();
    private opened = new Map<string, Drive>();
    private readonly reader: { read(): Promise<Disk[]> };
    private timers: ReturnType<typeof setInterval>[] = [];
    private last = "";
    /** the background work failing now, by problem key */
    private failing = new Set<string>();
    // one look at a time: a slow one is never overtaken by the next
    private looking: Promise<void> | null = null;

    constructor(private readonly options: PlacesOptions) {
        this.own = new Drive(options.root);
        this.reader = options.disks ?? new DiskReader();
    }

    async open(): Promise<void> {
        await fs.promises.mkdir(this.options.root, { recursive: true });
        await this.own.open();
        this.linked = await this.load();
        await this.readSpaceOf(OWN_PLACE);
        await this.refresh();
        const look = setInterval(() => {
            this.background(LOOK_PROBLEM, "Drive can't see which disks are plugged in", this.refresh());
        }, POLL_MS);
        const space = setInterval(() => this.refreshSpace(), SPACE_POLL_MS);
        for (const t of [look, space]) t.unref?.();
        this.timers = [look, space];
    }

    async close(): Promise<void> {
        for (const t of this.timers) clearInterval(t);
        this.timers = [];
        await Promise.all([this.own, ...this.opened.values()].map((d) => d.close()));
        this.opened.clear();
    }

    /** Every place, in the order the sidebar shows them. */
    list(): Place[] {
        const space = (id: string) => {
            const s = this.space.get(id);
            return s ? { free: s.free, total: s.total } : {};
        };
        const diskAt = (p: string) => this.disks.find((d) => within(p, d.mount));
        return [
            { id: OWN_PLACE, kind: "own", name: "Drive", location: this.options.root, available: true, ...space(OWN_PLACE) },
            ...[...this.disks]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                .map((d): Place => ({ id: diskId(d.mount), kind: "disk", name: d.name, location: d.mount, available: true, ...space(diskId(d.mount)) })),
            ...this.linked.map((f): Place => {
                const available = this.present.has(f.id);
                const onDisk = diskAt(f.path);
                return { id: f.id, kind: "folder", name: folderName(f.path), location: f.path, available, ...(onDisk ? { disk: diskId(onDisk.mount) } : {}), ...space(f.id) };
            }),
        ];
    }

    /** The drive over a place's root; it must be there. */
    async drive(id: string): Promise<Drive> {
        if (id === OWN_PLACE) return this.own;
        const root = this.rootOf(id);
        if (!(await isFolder(root))) {
            this.present.delete(id);
            await this.forget(id);
            this.publish();
            throw new Error(`“${this.nameOf(id)}” isn't there right now.`);
        }
        let drive = this.opened.get(id);
        if (!drive) {
            drive = new Drive(root);
            await drive.open();
            this.opened.set(id, drive);
        }
        return drive;
    }

    /** Links a folder on this computer; the place it is now. */
    async link(folder: string): Promise<Place> {
        if (!path.isAbsolute(folder)) throw new Error("Pick a folder to link.");
        const st = await fs.promises.stat(folder).catch((err: unknown) => {
            if (isMissing(err)) throw new Error(`“${folder}” isn't there.`);
            throw err;
        });
        if (!st.isDirectory()) throw new Error(`“${folder}” isn't a folder.`);
        const real = await fs.promises.realpath(folder);
        const own = await fs.promises.realpath(this.options.root);
        if (within(real, own) || within(own, real)) throw new Error("That folder holds Drive's own files, or is in them.");
        const disk = this.disks.find((d) => d.mount === real || d.mount === folder);
        if (disk) throw new Error(`“${disk.name}” is a disk: it's already under Drives.`);
        const same = this.linked.find((f) => f.path === real);
        if (same) throw new Error(`“${folderName(real)}” is already linked.`);
        const linked: Linked = { id: `folder-${randomBytes(6).toString("hex")}`, path: real };
        await this.save([...this.linked, linked]);
        this.linked = [...this.linked, linked];
        this.present.add(linked.id);
        await this.readSpaceOf(linked.id);
        this.publish();
        return this.list().find((p) => p.id === linked.id)!;
    }

    /** Stops showing a linked folder; its files stay where they are. */
    async unlink(id: string): Promise<void> {
        if (!this.linked.some((f) => f.id === id)) throw new Error("That folder isn't linked.");
        const rest = this.linked.filter((f) => f.id !== id);
        await this.save(rest);
        this.linked = rest;
        this.present.delete(id);
        await this.forget(id);
        this.publish();
    }

    /** Lets a disk go so it can be pulled out. */
    async eject(id: string): Promise<void> {
        const disk = this.disks.find((d) => diskId(d.mount) === id);
        if (!disk) throw new Error("That disk isn't plugged in.");
        // uploads to it stop first: the disk can't go while they write to it
        const onIt = [id, ...this.foldersOn([disk])];
        await Promise.all(onIt.map((p) => this.forget(p)));
        await ejectDisk(disk.mount);
        await this.refresh();
    }

    /** Looks at the disks plugged in and the linked folders again, as the poll does. */
    refresh(): Promise<void> {
        this.looking ??= this.look().finally(() => {
            this.looking = null;
        });
        return this.looking;
    }

    /** Files changed on a place: the space left on it is read again. */
    changed(id: string): void {
        this.background(
            SPACE_PROBLEM,
            "Drive can't read how much space is left",
            this.readSpaceOf(id).then(() => this.publish()),
        );
    }

    /** The folders in a folder on this computer, for picking one to link; "" is the home folder. */
    async browse(folder: string): Promise<HostFolder> {
        const at = folder === "" ? os.homedir() : folder;
        if (!path.isAbsolute(at)) throw new Error("That's not a folder on this computer.");
        const names = await fs.promises.readdir(at, { withFileTypes: true }).catch((err: unknown) => {
            if (isMissing(err)) throw new Error(`“${at}” isn't there.`);
            if ((err as NodeJS.ErrnoException).code === "EACCES" || (err as NodeJS.ErrnoException).code === "EPERM") throw new Error(`Paperboard isn't allowed to open “${at}”.`);
            throw err;
        });
        const folders = await Promise.all(
            names
                .filter((d) => !d.name.startsWith("."))
                .map(async (d) => {
                    const full = path.join(at, d.name);
                    if (d.isDirectory()) return { name: d.name, path: full };
                    if (!d.isSymbolicLink()) return null;
                    // a link to a folder is a folder to pick; a broken one, or one this can't follow, isn't
                    const st = await fs.promises.stat(full).catch((err: unknown) => {
                        if (["ENOENT", "EACCES", "EPERM", "ELOOP"].includes((err as NodeJS.ErrnoException).code ?? "")) return null;
                        throw err;
                    });
                    return st?.isDirectory() ? { name: d.name, path: full } : null;
                }),
        );
        const parent = path.dirname(at);
        return {
            path: at,
            name: folderName(at),
            parent: parent === at ? null : parent,
            folders: folders.filter((f): f is { name: string; path: string } => f !== null).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
        };
    }

    // ---------------------------------------------------------------- inside

    private rootOf(id: string): string {
        const linked = this.linked.find((f) => f.id === id);
        if (linked) return linked.path;
        const disk = this.disks.find((d) => diskId(d.mount) === id);
        if (disk) return disk.mount;
        throw new Error("That place isn't in Drive anymore.");
    }

    private nameOf(id: string): string {
        return this.list().find((p) => p.id === id)?.name ?? id;
    }

    /** Lets go of a place's drive: its uploads end, and the next call opens it again. */
    private async forget(id: string): Promise<void> {
        const drive = this.opened.get(id);
        this.opened.delete(id);
        this.space.delete(id);
        await drive?.close();
    }

    /** What's plugged in and what's there now: what left is let go, and what came is read. */
    private async look(): Promise<void> {
        const now = await this.reader.read();
        const gone = this.disks.filter((d) => !now.some((n) => n.mount === d.mount));
        const fresh = now.filter((n) => !this.disks.some((d) => d.mount === n.mount));
        this.disks = now;
        const arrived = fresh.map((d) => diskId(d.mount));
        const left = gone.map((d) => diskId(d.mount));
        await Promise.all(
            this.linked.map(async (f) => {
                const there = await isFolder(f.path);
                if (there === this.present.has(f.id)) return;
                if (there) {
                    this.present.add(f.id);
                    arrived.push(f.id);
                } else {
                    this.present.delete(f.id);
                    left.push(f.id);
                }
            }),
        );
        await Promise.all(left.map((id) => this.forget(id)));
        await Promise.all(arrived.map((id) => this.readSpaceOf(id)));
        this.publish();
    }

    /** Work no one waits on: a failure is a problem the panel shows, until the same work next succeeds. */
    private background(key: string, title: string, work: Promise<void>): void {
        work.then(
            () => {
                if (this.failing.delete(key)) this.options.onProblem(key, title, null);
            },
            (err: unknown) => {
                this.failing.add(key);
                this.options.onProblem(key, title, err);
            },
        );
    }

    /** The linked folders on these disks. */
    private foldersOn(disks: Disk[]): string[] {
        return this.linked.filter((f) => disks.some((d) => within(f.path, d.mount))).map((f) => f.id);
    }

    private async readSpace(): Promise<void> {
        await Promise.all([OWN_PLACE, ...this.disks.map((d) => diskId(d.mount)), ...this.present].map((id) => this.readSpaceOf(id)));
    }

    private refreshSpace(): void {
        this.background(
            SPACE_PROBLEM,
            "Drive can't read how much space is left",
            this.readSpace().then(() => this.publish()),
        );
    }

    /** Reads how full a place is; a place that isn't there has none. */
    private async readSpaceOf(id: string): Promise<void> {
        let root: string;
        try {
            root = id === OWN_PLACE ? this.options.root : this.rootOf(id);
        } catch (err) {
            // quiet: a place that left while this was queued has no space to read
            void err;
            return;
        }
        try {
            const st = await fs.promises.statfs(root);
            this.space.set(id, { free: st.bavail * st.bsize, total: st.blocks * st.bsize });
        } catch (err) {
            // a folder gone since it was looked at has no space: the next look says it's missing
            if (!isMissing(err)) throw err;
            this.space.delete(id);
        }
    }

    /** Tells the windows, only when something they show changed. */
    private publish(): void {
        const places = this.list();
        const json = JSON.stringify(places);
        if (json === this.last) return;
        this.last = json;
        this.options.onChange(places);
    }

    private async load(): Promise<Linked[]> {
        let text: string;
        try {
            text = await fs.promises.readFile(this.options.saved, "utf8");
        } catch (err) {
            if (isMissing(err)) return [];
            throw err;
        }
        const saved = JSON.parse(text) as Saved;
        if (!Array.isArray(saved?.folders) || !saved.folders.every((f) => typeof f?.id === "string" && typeof f?.path === "string")) {
            throw new Error(`The linked folders in ${this.options.saved} can't be read.`);
        }
        return saved.folders;
    }

    private save(folders: Linked[]): Promise<void> {
        const saved: Saved = { folders };
        return writeFileAtomic(this.options.saved, `${JSON.stringify(saved, null, 4)}\n`);
    }
}

/** A disk's place id: where it's mounted, which stays the same each time it's plugged in. */
export const diskId = (mount: string) => `disk:${mount}`;
