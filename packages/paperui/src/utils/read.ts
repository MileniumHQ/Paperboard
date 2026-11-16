import { batch, createComputed, createMemo, createSignal, getOwner, on, onCleanup, untrack, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { errorMessage } from "./errorMessage";
import { createFailureToast } from "./toasts";

/** Nothing to read: a source that is off. */
type Off = false | null | undefined;

/**
 * What is known newer than a read still out. A whole value replaces what is
 * there and drops that read; undefined forgets it, as before a first read. A function changes part of it (a row gone, a
 * progress line): it applies now, and again to the answer of a read still
 * out when it lands, so that read keeps it.
 */
export type ReadChange<T> = T | undefined | ((prev: T | undefined) => T | undefined);

export interface ReadOptions<T, S> {
    /**
     * What the read depends on. It reads at once and again each time this
     * changes to a different value; while it is `false`, `null` or `undefined` nothing is read and
     * a read still out is dropped (the value stays). Without it the read
     * starts once, at once. The fetcher gets its value.
     */
    source?: Accessor<S | Off>;
    /**
     * The field the items of every array in the value are matched by across
     * reads (default "id"), so a row keeps its identity, and only what changed
     * in it redraws. Items without it are matched by position.
     */
    key?: string;
    /**
     * What the service pushes: a subscribe function, called once with `land`,
     * that returns the function that stops it. Each push lands as a change
     * (see ReadChange): a whole value, or a function for the part it says.
     */
    follow?: (land: (change: ReadChange<T>) => void) => () => void;
    /** A failure's words, as the view shows them (default its own message). */
    message?: (err: unknown) => string;
    /**
     * Says a failed read as a danger toast (see createFailureToast): its
     * title is what failed, its message the failure's words. It closes
     * while a read is out and comes back if that one fails too. `retry`
     * gives it a Try again button, repeating the view's own.
     */
    failure?: { title: string; retry?: boolean };
}

export interface Read<T> {
    /** What was read last, pushed or set; undefined until the first answer. */
    value: Accessor<T | undefined>;
    /** A read is out. The value it will replace is still there. */
    loading: Accessor<boolean>;
    /** Why the newest read failed, until the next answer lands. The value stays as it was. */
    error: Accessor<string | null>;
    /** Reads again; an answer of a read still out is dropped. Resolves once this read has settled, never rejects. */
    reload: () => Promise<void>;
    /** Resolves once the read out now has settled: the first answer, for a view that waits for it. Never rejects. */
    ready: () => Promise<void>;
    /** A change the view knows is newer than any read out, such as an action's answer (see ReadChange). */
    set: (change: ReadChange<T>) => void;
}

/**
 * Data a view reads from a service. It holds the last answer, whether a read
 * is out, and why the newest one failed. Late answers lose: only the newest
 * read lands, a push or set newer than a read out is kept over its answer,
 * and nothing lands once the component is gone, so there is no token to
 * check. An answer is reconciled into what was there by `key`, so rows keep
 * their identity across reads.
 *
 * Call it in a component, which owns it. Made outside one, it is never
 * dropped and `follow` is never stopped.
 */
export function createRead<T, S = true>(fetcher: (source: S) => Promise<T>, options: ReadOptions<T, S> = {}): Read<T> {
    const key = options.key ?? "id";
    const message = options.message ?? errorMessage;
    const [state, setState] = createStore<{ value: T | undefined }>({ value: undefined });
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    let newest = 0;
    let gone = false;
    let out: Promise<void> = Promise.resolve();
    // the part-changes made while the newest read is out, for its answer
    let since: ((prev: T | undefined) => T | undefined)[] = [];

    const put = (next: T | undefined) =>
        // reconcile lands a whole new value too (the first, or one of another shape)
        setState("value", reconcile(next as never, { key, merge: false }) as never);

    const land = (answer: T | undefined) =>
        batch(() => {
            put(since.reduce<T | undefined>((value, change) => change(value), answer));
            since = [];
            setError(null);
            setLoading(false);
        });

    const drop = () => {
        newest++;
        since = [];
        setLoading(false);
    };

    const change = (next: ReadChange<T>) => {
        if (gone) return;
        if (typeof next !== "function") {
            drop();
            land(next);
            return;
        }
        const patch = next as (prev: T | undefined) => T | undefined;
        if (untrack(loading)) since.push(patch);
        put(patch(untrack(() => state.value) as T | undefined));
    };

    const start = (source: S): Promise<void> => {
        if (gone) return Promise.resolve();
        const mine = ++newest;
        const current = () => !gone && mine === newest;
        since = [];
        setLoading(true);
        out = (async () => {
            try {
                const next = await fetcher(source);
                if (current()) land(next);
            } catch (err) {
                if (!current()) return;
                since = [];
                batch(() => {
                    setError(message(err));
                    setLoading(false);
                });
            }
        })();
        return out;
    };

    const off = (source: S | Off): source is Off => source === false || source === null || source === undefined;
    // an equal value is no change: nothing to read again
    const source = options.source ? createMemo(options.source) : () => true as S;
    if (options.source) {
        createComputed(
            on(source, (now) => {
                if (off(now)) untrack(drop);
                else void untrack(() => start(now));
            }),
        );
    } else {
        void start(true as S);
    }

    if (options.follow) {
        const stop = options.follow(change);
        if (getOwner()) onCleanup(stop);
    }
    if (getOwner())
        onCleanup(() => {
            gone = true;
            newest++;
        });

    const reload = () => {
        const now = untrack(source);
        return off(now) ? Promise.resolve() : start(now);
    };

    if (options.failure) {
        const { title, retry } = options.failure;
        createFailureToast(() => (loading() ? null : error()), {
            title,
            action: retry ? { label: "Try again", onClick: () => void reload() } : undefined,
        });
    }

    return {
        value: () => state.value as T | undefined,
        loading,
        error,
        reload,
        ready: () => out,
        set: change,
    };
}
