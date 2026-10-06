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
