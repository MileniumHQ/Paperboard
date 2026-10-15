export type CanvasSyncState =
    | { status: "pending" | "saving" | "applied" }
    | { status: "error"; message: string };

export type CanvasSyncResult = { ok: true } | { ok: false; message: string };

/** One in-flight revision and one latest pending revision; never an edit queue. */
export function createCanvasSync<T>(options: {
    save: (snapshot: T) => Promise<unknown>;
    apply: (snapshot: T) => Promise<unknown>;
    onState: (state: CanvasSyncState) => void;
    delayMs?: number;
}) {
    let latest: { revision: number; snapshot: T } | undefined;
    let revision = 0;
    let applied = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: Promise<CanvasSyncResult> | undefined;

    const report = (state: CanvasSyncState) => {
        if (!disposed) options.onState(state);
    };

    async function drain(): Promise<CanvasSyncResult> {
        while (!disposed && latest && latest.revision !== applied) {
            const current = latest;
            let saved = false;
            report({ status: "saving" });
            try {
                await options.save(current.snapshot);
                saved = true;
                if (disposed) return { ok: false, message: "Canvas closed before changes were applied" };
                // A newer edit arrived during the write. Persist it before
                // applying, rather than briefly activating the old revision.
                if (current !== latest) continue;
                await options.apply(current.snapshot);
                applied = current.revision;
            } catch (err) {
                const message = `${saved ? "Canvas saved, but flows were not applied" : "Canvas could not be saved"}: ${err instanceof Error ? err.message : String(err)}`;
                // A newer revision can still succeed; no automatic retry of
                // the failed revision, and failure is never called applied.
                if (current !== latest && !disposed) continue;
                report({ status: "error", message });
                return { ok: false, message };
            }
        }
        if (disposed) return { ok: false, message: "Canvas sync is closed" };
        report({ status: "applied" });
        return { ok: true };
    }

    function flush(): Promise<CanvasSyncResult> {
        clearTimeout(timer);
        timer = undefined;
        if (disposed) return Promise.resolve({ ok: false, message: "Canvas sync is closed" });
        if (!active) active = drain().finally(() => { active = undefined; });
        return active;
    }

    return {
        schedule(snapshot: T) {
            if (disposed) return;
            // Solid store proxies require the JSON roundtrip. Refuse a
            // failed clone instead of saving a mutable shared reference.
            latest = { revision: ++revision, snapshot: JSON.parse(JSON.stringify(snapshot)) as T };
            report({ status: "pending" });
            clearTimeout(timer);
            timer = setTimeout(() => { void flush(); }, options.delayMs ?? 80);
        },
        flush,
        dispose() {
            disposed = true;
            clearTimeout(timer);
            latest = undefined;
        },
    };
}

/**
 * Follows canvas revisions saved by other windows. A change announces only
 * its revision; the canvas is pulled once nothing local is waiting to save,
 * so a remote canvas never replaces an edit this window has not saved yet.
 * One pull at a time: changes that land during a pull fold into the next.
 */
export function createCanvasFollower<S extends { revision: number }>(options: {
    clientId: string;
    fetch: () => Promise<S>;
    /** the revision this window's canvas was loaded from or last saved as */
    revision: () => number;
    /** true while local edits are pending or saving */
    busy: () => boolean;
    show: (snapshot: S) => void;
    onError: (message: string) => void;
}) {
    let wanted = 0;
    let force = false;
    let active: Promise<CanvasSyncResult> | undefined;
    let again = false;
    let disposed = false;

    function pull(): Promise<CanvasSyncResult> {
        if (active) { again = true; return active; }
        active = drain().finally(() => { active = undefined; });
        return active;
    }

    async function drain(): Promise<CanvasSyncResult> {
            do {
                again = false;
                if (disposed) return { ok: false, message: "Canvas follower is closed" };
                if (options.busy()) return { ok: false, message: "Wait for local edits to finish, then retry loading the canvas" };
                if (!force && wanted <= options.revision()) return { ok: true };
                const forced = force;
                force = false;
                try {
                    const snapshot = await options.fetch();
                    // re-checked after the wait: an edit made meanwhile wins,
                    // and its save on the older revision is refused and reloads
                    if (disposed || options.busy()) return { ok: false, message: "Canvas changed while loading; retry loading the canvas" };
                    // a forced pull shows any other revision: after a backup
                    // is loaded the service's revision is older than this one
                    if (forced ? snapshot.revision !== options.revision() : snapshot.revision > options.revision()) options.show(snapshot);
                } catch (err) {
                    const message = `Changes from another window could not be loaded: ${err instanceof Error ? err.message : String(err)}`;
                    if (!disposed) options.onError(message);
                    return { ok: false, message };
                }
            } while (again);
        return { ok: true };
    }

    return {
        /** A revision was saved somewhere. */
        changed(change: { revision?: unknown; clientId?: unknown }): Promise<CanvasSyncResult> {
            if (change?.clientId === options.clientId) return Promise.resolve({ ok: true });
            if (typeof change?.revision !== "number") return Promise.resolve({ ok: true });
            wanted = Math.max(wanted, change.revision);
            return pull();
        },
        /** Local edits settled; catch up on anything announced meanwhile. */
        idle(): Promise<CanvasSyncResult> {
            return pull();
        },
        /** Pull the service's canvas now (after a refused save or a loaded backup). */
        reload(): Promise<CanvasSyncResult> {
            force = true;
            return pull();
        },
        dispose() {
            disposed = true;
        },
    };
}
