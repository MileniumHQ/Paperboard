// Data: values a project's flows keep by key, through restarts, until they
// are deleted. Each project's are one file in the panel's files, written
// whole and atomically (the daemon writes a config file by temp and rename),
// so a write that fails or a crash midway leaves the last one as it was.
// Changes land in memory at once, in the order the runs make them, so two
// runs counting at the same time never lose a count; the file follows, one
// write at a time, a write already waiting carrying every change behind it.
import { isRecord } from "@mileniumhq/paperapi";
import { HeldQueue } from "./heldQueue";
import { isProjectId, type ProjectStorage } from "./projects";

export const DATA_VERSION = 1;
/** The most keys one project keeps. */
export const MAX_DATA_KEYS = 1000;
/** The longest a key may be, in characters. */
export const MAX_DATA_KEY = 200;
/**
 * The most one project's Data may hold: its file as it is written, in bytes.
 * Half what the daemon writes of a panel's file (1 MiB, measured the same way),
 * so a value this lets in is never refused when it is written.
 */
export const MAX_DATA_BYTES = 512 * 1024;

export function projectDataPath(id: string): string {
    if (!isProjectId(id)) throw new Error(`"${id}" is not a project id`);
    return `data/${id}.json`;
}

/** A project's Data as it was stored; nothing stored is none. One written by a newer Blocks, or damaged, is refused. */
export function readProjectData(saved: unknown): Map<string, unknown> {
    if (saved === null || saved === undefined) return new Map();
    if (!isRecord(saved) || !isRecord(saved.values)) throw new Error("the Data is damaged");
    if (typeof saved.version === "number" && saved.version > DATA_VERSION) {
        throw new Error(`it was saved by a newer version of Blocks (Data version ${saved.version}); update Blocks to read it`);
    }
    return new Map(Object.entries(saved.values));
}

function checkKey(key: unknown): string {
    if (typeof key !== "string" || !key) throw new Error("Data needs a key");
    if (key.length > MAX_DATA_KEY) throw new Error(`A key may be at most ${MAX_DATA_KEY} characters`);
    return key;
}

/** A value as it is kept: JSON, so what is read back is what was saved. */
function kept(value: unknown): unknown {
    if (value === undefined) throw new Error("Say what to save");
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("That value can't be saved");
    return JSON.parse(text);
}

/** The project's file: none when it keeps nothing. */
const fileOf = (values: Map<string, unknown>) => (values.size ? { version: DATA_VERSION, values: Object.fromEntries(values) } : null);

const encoder = new TextEncoder();
/** The file's size as the daemon writes it: pretty-printed, as UTF-8. */
const sizeOf = (values: Map<string, unknown>) => encoder.encode(JSON.stringify(fileOf(values), null, 2)).length;

/** Why these values can't be kept, or null when they can. */
function pastLimits(values: Map<string, unknown>): string | null {
    if (values.size > MAX_DATA_KEYS) return `A project keeps at most ${MAX_DATA_KEYS} keys of Data; delete some first`;
    if (sizeOf(values) > MAX_DATA_BYTES) return `A project's Data may hold at most ${MAX_DATA_BYTES / 1024} KB, and this would pass it`;
    return null;
}

export class DataStore {
    // each project's values, once read: the file is read the first time a flow uses it
    private loaded = new Map<string, Promise<Map<string, unknown>>>();
    private readonly queue = new HeldQueue();
    // a write queued and not started yet, by project, with the values it writes: a change made
    // to those values meanwhile rides on it
    private waiting = new Map<string, { values: Promise<Map<string, unknown>>; write: Promise<void> }>();

    constructor(private readonly storage: ProjectStorage) {}

    get paused(): boolean {
        return this.queue.paused;
    }

    /** Resolves once every write before it is done, and holds the later ones until `resume`. */
    pause(): Promise<void> {
        return this.queue.pause();
    }

    /**
     * Lets the held writes run. After a restore the files are the backup's:
     * what was read is let go first, so each project's Data is read from them
     * again, and a write held for the old Data has nothing left to write.
     */
    resume(restored: boolean): Promise<void> {
        return this.queue.resume(
            restored
                ? async () => {
                      this.loaded.clear();
                  }
                : undefined,
        );
    }

    private values(project: string): Promise<Map<string, unknown>> {
        let values = this.loaded.get(project);
        if (!values) {
            // read in its turn, so it never meets a file being written or swapped by a restore
            values = this.queue.run(async () => readProjectData(await this.storage.get(projectDataPath(project))));
            this.loaded.set(project, values);
            // quiet: the block that asked fails with why; this only lets the next one read again
            values.catch(() => {
                if (this.loaded.get(project) === values) this.loaded.delete(project);
            });
        }
        return values;
    }

    /**
     * Writes these values of the project as they are when the write starts. Values let go of
     * meanwhile (by a restore or a delete) aren't the file's anymore, so they write nothing; and
     * the write never waits on a read, which may be queued behind it.
     */
    private write(project: string, values: Promise<Map<string, unknown>>): Promise<void> {
        const queued = this.waiting.get(project);
        if (queued?.values === values) return queued.write;
        const write = this.queue.run(async () => {
            if (this.waiting.get(project)?.write === write) this.waiting.delete(project);
            if (this.loaded.get(project) !== values) return;
            await this.storage.set(fileOf(await values), projectDataPath(project));
        });
        this.waiting.set(project, { values, write });
        return write;
    }

    /** Changes the value under `key` and writes it; a change that passes the limits is undone and refused. */
    private async changeValue<T>(project: string, key: unknown, change: (values: Map<string, unknown>, name: string) => T): Promise<T> {
        const loading = this.values(project);
        const values = await loading;
        const name = checkKey(key);
        const had = values.has(name);
        const before = values.get(name);
        const result = change(values, name);
        const why = pastLimits(values);
        if (why) {
            if (had) values.set(name, before);
            else values.delete(name);
            throw new Error(why);
        }
        await this.write(project, loading);
        return result;
    }

    /** The value kept under `key`, or undefined when there is none. */
    async get(project: string, key: unknown): Promise<unknown> {
        const values = await this.values(project);
        const name = checkKey(key);
        return values.has(name) ? structuredClone(values.get(name)) : undefined;
    }

    async has(project: string, key: unknown): Promise<boolean> {
        return (await this.values(project)).has(checkKey(key));
    }

    /** Every key, in the order a person reads them. */
    async keys(project: string): Promise<string[]> {
        return [...(await this.values(project)).keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    /** Keeps `value` under `key`; resolves once it is written. A value past the limits changes nothing. */
    set(project: string, key: unknown, value: unknown): Promise<void> {
        return this.changeValue(project, key, (values, name) => void values.set(name, kept(value)));
    }

    /** Adds `by` to the number under `key` (none is 0); the new number. A key past the limits changes nothing. */
    change(project: string, key: unknown, by: number): Promise<number> {
        return this.changeValue(project, key, (values, name) => {
            if (!Number.isFinite(by)) throw new Error("The change must be a number");
            const current = values.get(name) ?? 0;
            if (typeof current !== "number") throw new Error(`"${name}" holds ${Array.isArray(current) ? "a list" : typeof current === "object" ? "an object" : `the ${typeof current} ${JSON.stringify(current)}`}, not a number`);
            const next = current + by;
            if (!Number.isFinite(next)) throw new Error("The answer isn't a number");
            values.set(name, next);
            return next;
        });
    }

    /** Forgets the value under `key`; whether there was one. */
    async delete(project: string, key: unknown): Promise<boolean> {
        const loading = this.values(project);
        const values = await loading;
        if (!values.delete(checkKey(key))) return false;
        await this.write(project, loading);
        return true;
    }

    /** A deleted project's Data goes with it. */
    remove(project: string): Promise<void> {
        this.loaded.delete(project);
        return this.queue.run(() => this.storage.set(null, projectDataPath(project)));
    }
}
