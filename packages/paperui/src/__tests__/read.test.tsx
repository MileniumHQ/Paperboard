import { createRoot, createSignal, For } from "solid-js";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { createRead } from "../utils/read";

// a promise and the functions that settle it
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// lets every already-queued promise reaction run
async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

const roots: (() => void)[] = [];
function inRoot<T>(fn: () => T): T {
    return createRoot((dispose) => {
        roots.push(dispose);
        return fn();
    });
}
afterEach(() => {
    for (const dispose of roots.splice(0)) dispose();
});

/** a fetcher whose every call waits for the test to answer it */
function calls<T>() {
    const out: ReturnType<typeof deferred<T>>[] = [];
    const fetcher = () => {
        const d = deferred<T>();
        out.push(d);
        return d.promise;
    };
    return { out, fetcher };
}

describe("createRead", () => {
    test("reads at once: loading, then the value", async () => {
        const { out, fetcher } = calls<string>();
        const read = inRoot(() => createRead(fetcher));
        expect(out).toHaveLength(1);
        expect(read.loading()).toBe(true);
        expect(read.value()).toBeUndefined();
        out[0]!.resolve("worlds");
        await flush();
        expect(read.loading()).toBe(false);
        expect(read.value()).toBe("worlds");
    });

    test("a failure is the error, in the view's words, and the value stays; the next answer clears it", async () => {
        const { out, fetcher } = calls<string>();
        const read = inRoot(() => createRead(fetcher, { message: (err) => `said: ${(err as Error).message}` }));
        out[0]!.resolve("first");
        await flush();
        void read.reload();
        out[1]!.reject(new Error("EACCES"));
        await flush();
        expect(read.error()).toBe("said: EACCES");
        expect(read.value()).toBe("first");
        expect(read.loading()).toBe(false);
        void read.reload();
        out[2]!.resolve("second");
        await flush();
        expect(read.error()).toBeNull();
        expect(read.value()).toBe("second");
    });

    test("an older answer never lands over a newer one, nor does its failure", async () => {
        const { out, fetcher } = calls<string>();
        const read = inRoot(() => createRead(fetcher));
        void read.reload();
        out[1]!.resolve("newer");
        await flush();
        out[0]!.resolve("older");
        await flush();
        expect(read.value()).toBe("newer");
        void read.reload();
        void read.reload();
        out[3]!.resolve("newest");
        out[2]!.reject(new Error("old failure"));
        await flush();
        expect(read.value()).toBe("newest");
        expect(read.error()).toBeNull();
    });

    test("nothing lands once the component is gone", async () => {
        const { out, fetcher } = calls<string>();
        let dispose!: () => void;
        const read = createRoot((d) => {
            dispose = d;
            return createRead(fetcher);
        });
        dispose();
        out[0]!.resolve("late");
        await flush();
        expect(read.value()).toBeUndefined();
        await read.reload();
        expect(out).toHaveLength(1);
    });

    test("a row keeps its identity across reads, matched by key wherever it moved", async () => {
        type Row = { name: string; size: number };
        const { out, fetcher } = calls<Row[]>();
        const built: string[] = [];
        const read = inRoot(() => createRead(fetcher, { key: "name" }));
        render(() => (
            <For each={read.value() ?? []}>
                {(row) => {
                    built.push(row.name);
                    return <span>{row.size}</span>;
                }}
            </For>
        ));
        out[0]!.resolve([
            { name: "a", size: 1 },
            { name: "b", size: 2 },
        ]);
        await flush();
        const first = read.value()![1];
        void read.reload();
        out[1]!.resolve([
            { name: "b", size: 3 },
            { name: "a", size: 1 },
        ]);
        await flush();
        expect(built).toEqual(["a", "b"]);
        expect(read.value()![0]).toBe(first);
        expect(read.value()![0]!.size).toBe(3);
    });

    test("a push lands, clears the error, and drops a read still out; it stops with the component", async () => {
        const { out, fetcher } = calls<string>();
        let push!: (value: string) => void;
        let stopped = false;
        let dispose!: () => void;
        const read = createRoot((d) => {
            dispose = d;
            return createRead(fetcher, {
                follow: (land) => {
                    push = land;
                    return () => (stopped = true);
                },
            });
        });
        push("pushed");
        expect(read.value()).toBe("pushed");
        expect(read.loading()).toBe(false);
        out[0]!.resolve("read before the push");
        await flush();
        expect(read.value()).toBe("pushed");
        dispose();
        expect(stopped).toBe(true);
    });

    test("a whole value set lands at once and drops a read still out", async () => {
        const { out, fetcher } = calls<string[]>();
        const read = inRoot(() => createRead(fetcher));
        void read.reload();
        read.set(["from an action"]);
        expect(read.value()).toEqual(["from an action"]);
        expect(read.loading()).toBe(false);
        out[1]!.resolve(["read before the action"]);
        await flush();
        expect(read.value()).toEqual(["from an action"]);
    });

    test("a part-change lands at once and again over the answer of a read still out", async () => {
        type Status = { list: string[]; progress: number };
        const { out, fetcher } = calls<Status>();
        let push!: (change: (prev: Status | undefined) => Status | undefined) => void;
        const read = inRoot(() => createRead(fetcher, { follow: (land) => ((push = land), () => {}) }));
        out[0]!.resolve({ list: ["a", "b"], progress: 0 });
        await flush();
        void read.reload();
        push((prev) => prev && { ...prev, progress: 40 });
        read.set((prev) => prev && { ...prev, list: prev.list.filter((x) => x !== "a") });
        expect(read.value()).toEqual({ list: ["b"], progress: 40 });
        expect(read.loading()).toBe(true);
        // read before the push and the removal: it keeps both
        out[1]!.resolve({ list: ["a", "b", "c"], progress: 10 });
        await flush();
        expect(read.value()).toEqual({ list: ["b", "c"], progress: 40 });
        // the next read is newer than them, and stands as it is
        void read.reload();
        out[2]!.resolve({ list: ["a"], progress: 100 });
        await flush();
        expect(read.value()).toEqual({ list: ["a"], progress: 100 });
    });

    test("a source reads on each change to a new value, reads nothing while off, and an off source drops the read out", async () => {
        const { out, fetcher } = calls<string>();
        const [open, setOpen] = createSignal<string | false>(false);
        const asked: (string | false)[] = [];
        const read = inRoot(() =>
            createRead((source: string) => {
                asked.push(source);
                return fetcher();
            }, { source: open }),
        );
        expect(out).toHaveLength(0);
        expect(read.loading()).toBe(false);
        setOpen("one");
        expect(asked).toEqual(["one"]);
        setOpen(false);
        expect(read.loading()).toBe(false);
        out[0]!.resolve("for one");
        await flush();
        expect(read.value()).toBeUndefined();
        await read.reload();
        expect(out).toHaveLength(1);
        setOpen("two");
        out[1]!.resolve("for two");
        await flush();
        expect(read.value()).toBe("for two");
        // the same value again is no change
        setOpen("two");
        expect(out).toHaveLength(2);
    });

    test("ready resolves once the read out has settled, failed included", async () => {
        const { out, fetcher } = calls<string>();
        const read = inRoot(() => createRead(fetcher));
        let ready = false;
        void read.ready().then(() => (ready = true));
        await flush();
        expect(ready).toBe(false);
        out[0]!.reject(new Error("no"));
        await flush();
        expect(ready).toBe(true);
    });
});
