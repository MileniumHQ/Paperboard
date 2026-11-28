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
import { COMPUTER, OWN_PLACE, type HostFolder, type Place } from "./contract";
import { DiskReader, ejectDisk, windowsLetters, type Disk } from "./disks";
import { Drive, within, type Space } from "./drive";

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

const codeOf = (err: unknown) => (err as NodeJS.ErrnoException)?.code ?? "";
const isMissing = (err: unknown) => codeOf(err) === "ENOENT";
/** A path that leads nowhere this can go: not there, through a file, not allowed in, or round a loop. */
const isUnreachable = (err: unknown) => ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(codeOf(err));
const folderName = (p: string) => path.basename(p) || p;
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });
/** Whether a folder is there to open; one this can't reach isn't, for now. */
const isFolder = (p: string) =>
    fs.promises.stat(p).then(
        (st) => st.isDirectory(),
        (err: unknown) => {
            if (isUnreachable(err)) return false;
            throw err;
        },
    );

export interface PlacesOptions {
    /** Drive's own folder, made when it's missing */
    root: string;
    /** where the linked folders are kept */
    saved: string;
    /** reads the disks plugged in; the system's, unless a test gives its own */
    disks?: { read(): Promise<Disk[]> };
    /** hears the places whenever they change */
    onChange: (places: Place[]) => void;
    /** hears a disk that left without Eject: pulled out, or let go by the system */
    onUnplugged: (disk: { id: string; name: string }) => void;
    /**
     * Hears a failure no one asked for (the disks couldn't be read), by what
     * it's about, and null once that works again: the panel shows it as a
     * problem until then.
     */
    onProblem: (key: string, title: string, error: unknown | null) => void;
}

/** The problems the background work reports, by key, with what each says. */
export const PROBLEMS = {
    look: "Drive can't see which disks are plugged in",
    space: "Drive can't read how much space is left",
} as const;
type Problem = keyof typeof PROBLEMS;

export class Places {
    readonly own: Drive;
    private linked: Linked[] = [];
    private disks: Disk[] = [];
    private space = new Map<string, Space>();
    /** the linked folders that are there now */
    private present = new Set<string>();
    // a drive is kept from the moment it starts opening, so two calls at once share it
    private opened = new Map<string, Promise<Drive>>();
    /** the disks being ejected: their leaving was asked for */
    private ejecting = new Set<string>();
    private readonly reader: { read(): Promise<Disk[]> };
    private timers: ReturnType<typeof setInterval>[] = [];
    private last = "";
    /** the background work failing now, by problem key */
    private failing = new Set<string>();
    // one look at a time: a slow one is never overtaken by the next
    private looking: Promise<void> | null = null;
    /** the look asked for while one was under way: it starts once that one is done */
    private queued: Promise<void> | null = null;
    /** links and unlinks, one at a time: each saves the list the one before it left */
    private changing: Promise<unknown> = Promise.resolve();

    constructor(private readonly options: PlacesOptions) {
        this.own = new Drive(options.root);
        this.reader = options.disks ?? new DiskReader();
    }

    async open(): Promise<void> {
        await fs.promises.mkdir(this.options.root, { recursive: true });
        await this.own.open();
        this.linked = await this.load();
        await this.readSpaceOf(OWN_PLACE);
        // the windows see Drive's own folder and the linked ones, as they are, before any disk is looked at
        await this.background("look", this.lookAtFolders());
        this.publish();
        // the first look fails the way every later one can: as a problem, with Drive's own folder still open
        await this.background("look", this.refresh());
        // the poll skips a turn while a look is under way
        const look = setInterval(() => {
            if (!this.looking && !this.queued) void this.background("look", this.startLook());
        }, POLL_MS);
        const space = setInterval(() => this.refreshSpace(), SPACE_POLL_MS);
        for (const t of [look, space]) t.unref?.();
        this.timers = [look, space];
    }

    async close(): Promise<void> {
        for (const t of this.timers) clearInterval(t);
        this.timers = [];
        await Promise.all([this.own.close(), ...[...this.opened.keys()].map((id) => this.forget(id))]);
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
                .sort(byName)
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
        let opening = this.opened.get(id);
        if (!opening) {
            const drive = new Drive(root);
            const made = drive.open().then(() => drive);
            opening = made;
            this.opened.set(id, made);
            made.catch(() => {
                // quiet: the call that opened it hears why; the next one tries again
                if (this.opened.get(id) === made) this.opened.delete(id);
            });
        }
        return opening;
    }

    /** Links a folder on this computer; the place it is now. */
    link(folder: string): Promise<Place> {
        return this.oneAtATime(() => this.linkNow(folder));
    }

    /** Stops showing a linked folder; its files stay where they are. */
    unlink(id: string): Promise<void> {
        return this.oneAtATime(() => this.unlinkNow(id));
    }

    private oneAtATime<T>(change: () => Promise<T>): Promise<T> {
        const next = this.changing.then(change, change);
        this.changing = next.then(
            () => undefined,
            () => undefined, // quiet: the caller of that change hears why it failed
        );
        return next;
    }

    private async linkNow(folder: string): Promise<Place> {
        if (!path.isAbsolute(folder)) throw new Error("Pick a folder to link.");
        const st = await fs.promises.stat(folder).catch((err: unknown) => {
            if (isMissing(err)) throw new Error(`“${folder}” isn't there.`);
            throw err;
        });
        if (!st.isDirectory()) throw new Error(`“${folder}” isn't a folder.`);
        const real = await fs.promises.realpath(folder);
        const problem = await this.cannotLink(real, folder);
        if (problem) throw new Error(problem);
        const linked: Linked = { id: `folder-${randomBytes(6).toString("hex")}`, path: real };
        await this.save([...this.linked, linked]);
        this.linked = [...this.linked, linked];
        this.present.add(linked.id);
        await this.readSpaceOf(linked.id);
        this.publish();
        return this.list().find((p) => p.id === linked.id)!;
    }

    private async unlinkNow(id: string): Promise<void> {
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
        // its leaving was asked for, so it isn't said to be unplugged when the next look finds it gone
        this.ejecting.add(id);
        try {
            await ejectDisk(disk.mount);
        } catch (err) {
            this.ejecting.delete(id);
            throw err;
        }
        await this.refresh();
    }

    /** Looks at the disks plugged in and the linked folders again, in a look that starts after this is asked. */
    refresh(): Promise<void> {
        if (!this.looking) return this.startLook();
        // the look under way may have read the disks before what the caller changed
        this.queued ??= this.looking
            .then(
                () => undefined,
                () => undefined, // quiet: that look's failure went to whoever started it
            )
            .then(() => {
                this.queued = null;
                return this.startLook();
            });
        return this.queued;
    }

    private startLook(): Promise<void> {
        const look = this.look().finally(() => {
            if (this.looking === look) this.looking = null;
        });
        this.looking = look;
        return look;
    }

    /** Files changed on a place: the space left on it is read again. */
    changed(id: string): void {
        void this.background("space", this.readSpaceOf(id).then(() => this.publish()));
    }

    /** The folders in a folder on this computer, for picking one to link; "" is the home folder, COMPUTER its top. */
    async browse(folder: string): Promise<HostFolder> {
        if (folder === COMPUTER) return this.computer();
        const at = folder === "" ? os.homedir() : folder;
        if (!path.isAbsolute(at)) throw new Error("That's not a folder on this computer.");
        const names = await fs.promises.readdir(at, { withFileTypes: true }).catch((err: unknown) => {
            if (isMissing(err)) throw new Error(`“${at}” isn't there.`);
            if (codeOf(err) === "ENOTDIR") throw new Error(`“${at}” isn't a folder.`);
            if (codeOf(err) === "EACCES" || codeOf(err) === "EPERM") throw new Error(`Paperboard isn't allowed to open “${at}”.`);
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
                    return (await isFolder(full)) ? { name: d.name, path: full } : null;
                }),
        );
        const parent = path.dirname(at);
        // a Windows drive letter's top sits under the computer, beside the other letters
        const top = parent === at ? (process.platform === "win32" ? COMPUTER : null) : parent;
        const cannotLink = await this.cannotLink(await fs.promises.realpath(at), at);
        return {
            path: at,
            name: folderName(at),
            parent: top,
            folders: folders.filter((f): f is { name: string; path: string } => f !== null).sort(byName),
            ...(cannotLink ? { cannotLink } : {}),
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

    /** The computer's top: each drive letter on Windows, and "/" anywhere else. */
    private async computer(): Promise<HostFolder> {
        const tops = process.platform === "win32" ? (await windowsLetters()).map(({ letter }) => `${letter}:\\`) : ["/"];
        return { path: COMPUTER, name: "This computer", parent: null, folders: tops.map((p) => ({ name: p, path: p })), cannotLink: "Pick a folder on one of its disks." };
    }

    /** Why a folder can't be linked (by its real path, and as it was named), or null when it can. */
    private async cannotLink(real: string, named: string): Promise<string | null> {
        const own = await fs.promises.realpath(this.options.root);
        const name = `“${folderName(named)}”`;
        if (within(real, own)) return `${name} is in Drive's own files: they're under Drive already.`;
        if (within(own, real)) return `${name} holds Drive's own files. Pick a folder inside it.`;
        const disk = this.disks.find((d) => d.mount === real || d.mount === named);
        if (disk) return `“${disk.name}” is a disk: it's already under Drives.`;
        if (this.linked.some((f) => f.path === real)) return `“${folderName(real)}” is already linked.`;
        return null;
    }

    /** Lets go of a place's drive: its uploads end, and the next call opens it again. */
    private async forget(id: string): Promise<void> {
        const opening = this.opened.get(id);
        this.opened.delete(id);
        this.space.delete(id);
        const drive = await opening?.catch(() => null); // quiet: a drive that never opened has nothing to let go
        await drive?.close();
    }

    /**
     * What's there now: the linked folders, then the disks plugged in. What
     * left is let go, and what came is read. Each is looked at whole before
     * it changes anything, and a failing disk read never holds back the
     * folders, which are looked at first.
     */
    private async look(): Promise<void> {
        await this.lookAtFolders();
        await this.lookAtDisks();
    }

    private async lookAtFolders(): Promise<void> {
        const linked = this.linked;
        const there = await Promise.all(linked.map((f) => isFolder(f.path)));
        const arrived: string[] = [];
        const left: string[] = [];
        linked.forEach((f, i) => {
            // a folder unlinked while this looked is no longer this look's to change
            if (!this.linked.includes(f) || there[i] === this.present.has(f.id)) return;
            if (there[i]) this.present.add(f.id);
            else this.present.delete(f.id);
            (there[i] ? arrived : left).push(f.id);
        });
        await this.settle(arrived, left);
    }

    private async lookAtDisks(): Promise<void> {
        const now = await this.reader.read();
        const gone = this.disks.filter((d) => !now.some((n) => n.mount === d.mount));
        const fresh = now.filter((n) => !this.disks.some((d) => d.mount === n.mount));
        this.disks = now;
        for (const d of gone) {
            const id = diskId(d.mount);
            if (!this.ejecting.delete(id)) this.options.onUnplugged({ id, name: d.name });
        }
        await this.settle(
            fresh.map((d) => diskId(d.mount)),
            gone.map((d) => diskId(d.mount)),
        );
    }

    /** Lets go of the places that left, tells the windows, then reads the space on the ones that came. */
    private async settle(arrived: string[], left: string[]): Promise<void> {
        await Promise.all(left.map((id) => this.forget(id)));
        this.publish();
        await Promise.all(arrived.map((id) => this.readSpaceOf(id)));
        this.publish();
    }

    /** Work no one waits on: a failure is a problem the panel shows, until the same work next succeeds. */
    private background(key: Problem, work: Promise<void>): Promise<void> {
        return work.then(
            () => {
                if (this.failing.delete(key)) this.options.onProblem(key, PROBLEMS[key], null);
            },
            (err: unknown) => {
                this.failing.add(key);
                this.options.onProblem(key, PROBLEMS[key], err);
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
        void this.background("space", this.readSpace().then(() => this.publish()));
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
            // a folder gone since it was looked at, or one this isn't allowed into, has no space it can read
            if (!isUnreachable(err)) throw err;
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
