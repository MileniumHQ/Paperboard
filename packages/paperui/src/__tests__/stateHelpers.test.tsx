import { createEffect, createRoot, createSignal, on } from "solid-js";
import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { PaperToggle } from "../components/PaperToggle";
import { createAction } from "../utils/action";
import { dismissToast, shownToasts } from "../utils/toasts";
import { createStateSignal, keepUnchanged, sameData } from "../utils/keepUnchanged";
import { createLatest } from "../utils/latest";
import { createSavedValue } from "../utils/savedValue";

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
/** runs `fn` in a root that the test's end disposes */
function inRoot<T>(fn: () => T): T {
    return createRoot((dispose) => {
        roots.push(dispose);
        return fn();
    });
}
afterEach(() => {
    for (const dispose of roots.splice(0)) dispose();
    for (const toast of [...shownToasts()]) dismissToast(toast.id);
});

describe("createLatest", () => {
    test("only the newest read is current", () => {
        const latest = inRoot(() => createLatest());
        const first = latest();
        expect(first()).toBe(true);
        const second = latest();
        expect(first()).toBe(false);
        expect(second()).toBe(true);
    });

    test("no read is current once the component that made it is gone", () => {
        let dispose!: () => void;
        const latest = createRoot((d) => {
            dispose = d;
            return createLatest();
        });
        const read = latest();
        dispose();
        expect(read()).toBe(false);
    });

    test("cancel drops the read in flight, and the next read is current again", () => {
        const latest = inRoot(() => createLatest());
        const read = latest();
        latest.cancel();
        expect(read()).toBe(false);
        expect(latest()()).toBe(true);
    });
});

describe("createAction", () => {
    test("busy while any run is going; a failure is its title and own words, cleared when the next run starts", async () => {
        const action = inRoot(() => createAction());
        const slow = deferred();
        const quick = deferred();
        const first = action.run("Server not removed", () => slow.promise);
        const second = action.run("Server not removed", () => quick.promise);
        expect(action.busy()).toBe(true);
        quick.resolve();
        expect(await second).toBe(true);
        // the first is still going
        expect(action.busy()).toBe(true);
        slow.reject(new Error("The server is running"));
        expect(await first).toBe(false);
        expect(action.busy()).toBe(false);
        expect(action.error()).toEqual({ title: "Server not removed", message: "The server is running" });
        const again = action.run("Server not removed", async () => {});
        expect(action.error()).toBeNull();
        expect(await again).toBe(true);
    });

    test("a failure is a toast that closes once a run of the same title goes through; toast: false keeps it only in error", async () => {
        const action = inRoot(() => createAction());
        const titles = () => shownToasts().map((t) => `${t.title}: ${t.message}`);
        expect(await action.run("Couldn't rename it", () => Promise.reject("taken"))).toBe(false);
        expect(await action.run("Couldn't move it", () => Promise.reject("full"))).toBe(false);
        expect(titles()).toEqual(["Couldn't rename it: taken", "Couldn't move it: full"]);
        // another title going through leaves the rename's failure standing
        expect(await action.run("Couldn't move it", async () => {})).toBe(true);
        expect(titles()).toEqual(["Couldn't rename it: taken"]);
        expect(await action.run("Couldn't rename it", async () => {})).toBe(true);
        expect(titles()).toEqual([]);

        const inPlace = inRoot(() => createAction({ toast: false }));
        expect(await inPlace.run("Couldn't rename it", () => Promise.reject("taken"))).toBe(false);
        expect(inPlace.error()).toEqual({ title: "Couldn't rename it", message: "taken" });
        expect(titles()).toEqual([]);
    });

    test("a failure's words come from the action's own formatter when it has one", async () => {
        const action = inRoot(() => createAction({ message: (err) => `Said plainly: ${String(err)}` }));
        expect(await action.run("Not saved", () => Promise.reject("EACCES"))).toBe(false);
        expect(action.error()).toEqual({ title: "Not saved", message: "Said plainly: EACCES" });
    });
});

describe("keepUnchanged", () => {
    test("an equal copy is the old value itself, all the way down", () => {
        const prev = { rows: [{ id: "a", tags: new Set(["x"]) }], stats: new Map([["p", { kills: 1 }]]), name: "World" };
        const copy = { rows: [{ id: "a", tags: new Set(["x"]) }], stats: new Map([["p", { kills: 1 }]]), name: "World" };
        expect(keepUnchanged(prev, copy)).toBe(prev);
        expect(sameData(prev, copy)).toBe(true);
        expect(sameData(prev, { ...copy, name: "Other" })).toBe(false);
    });

    test("a changed copy keeps every unchanged row, matched by id wherever it moved", () => {
        const a = { id: "a", n: 1 };
        const b = { id: "b", n: 2 };
        const next = keepUnchanged([a, b], [{ id: "b", n: 2 }, { id: "a", n: 1 }, { id: "c", n: 3 }]);
        expect(next[0]).toBe(b);
        expect(next[1]).toBe(a);
        expect(next[2]).toEqual({ id: "c", n: 3 });
        const changed = keepUnchanged([a, b], [{ id: "a", n: 1 }, { id: "b", n: 5 }]);
        expect(changed[0]).toBe(a);
        expect(changed[1]).toEqual({ id: "b", n: 5 });
    });

    test("createStateSignal: an equal push notifies no one, a changed one keeps its unchanged parts", () => {
        const seen: unknown[] = [];
        const [rows, setRows] = inRoot(() => {
            const signal = createStateSignal([{ id: 1, name: "Ada" }]);
            createEffect(on(signal[0], (rows) => seen.push(rows)));
            return signal;
        });
        const first = rows()[0];
        setRows([{ id: 1, name: "Ada" }]);
        expect(seen).toHaveLength(1);
        setRows((prev) => [...prev.map((r) => ({ ...r })), { id: 2, name: "Lin" }]);
        expect(seen).toHaveLength(2);
        expect(rows()[0]).toBe(first);
    });
});

/** a setting saved by `write`, stored in a signal a test sets as reads and pushes would */
function setting<T>(initial: T, write: (value: T) => Promise<boolean | void>) {
    return inRoot(() => {
        const [stored, setStored] = createSignal<T>(initial);
        const saved = createSavedValue(stored, write);
        return { saved, setStored };
    });
}

describe("createSavedValue", () => {
    test("a change shows at once; saves run one at a time in order, and one replaced before its turn is never written", async () => {
        const writes: string[] = [];
        const turns: ReturnType<typeof deferred<void>>[] = [];
        const { saved } = setting("a", (v) => {
            writes.push(v);
            const turn = deferred();
            turns.push(turn);
            return turn.promise;
        });
        const toB = saved.set("b");
        expect(saved.value()).toBe("b");
        expect(saved.saving()).toBe(true);
        await flush();
        expect(writes).toEqual(["b"]);
        // made while b saves: they wait for it
        const toC = saved.set("c");
        const toD = saved.set("d");
        expect(saved.value()).toBe("d");
        await flush();
        expect(writes).toEqual(["b"]);
        turns[0]!.resolve();
        await toB;
        await toC;
        await flush();
        // c was replaced by d before its turn
        expect(writes).toEqual(["b", "d"]);
        turns[1]!.resolve();
        await toD;
        expect(saved.value()).toBe("d");
        expect(saved.saving()).toBe(false);
    });

    test("when the newest save fails it rejects with its error, back on what is saved: the last change that landed, else what is stored", async () => {
        let fail = false;
        const { saved } = setting("a", async () => {
            if (fail) throw new Error("disk full");
        });
        await saved.set("b");
        fail = true;
        const failed = saved.set("c");
        expect(saved.value()).toBe("c");
        await expect(failed).rejects.toThrow("disk full");
        expect(saved.value()).toBe("b");

        const fresh = setting("a", async () => {
            throw new Error("refused");
        });
        await expect(fresh.saved.set("z")).rejects.toThrow("refused");
        expect(fresh.saved.value()).toBe("a");
    });

    test("a save called off (resolving false) goes back to what is stored, with no error", async () => {
        const { saved } = setting("C:/Games", async () => false);
        await saved.set("D:/Games");
        expect(saved.value()).toBe("C:/Games");
    });

    test("what is stored shows when nothing is saving; a push while a change saves doesn't replace it", async () => {
        const turn = deferred();
        const { saved, setStored } = setting(1, () => turn.promise);
        setStored(2);
        expect(saved.value()).toBe(2);
        const change = saved.set(3);
        setStored(4);
        expect(saved.value()).toBe(3);
        turn.resolve();
        await change;
        expect(saved.value()).toBe(3);
        // a later read is the truth
        setStored(5);
        expect(saved.value()).toBe(5);
    });

    test("a save whose own answer moved what is stored shows what is stored", async () => {
        let setStored!: (v: string) => void;
        const saved = inRoot(() => {
            const [stored, set] = createSignal(" a ");
            setStored = set;
            return createSavedValue(stored, async (v) => setStored(v.trim()));
        });
        await saved.set(" b ");
        expect(saved.value()).toBe("b");
    });

    test("one queue keeps several values' saves, and other work, in order", async () => {
        const log: string[] = [];
        const gate = deferred();
        let tail: Promise<unknown> = Promise.resolve();
        const queue = <R,>(task: () => Promise<R>): Promise<R> => {
            const result = tail.then(task);
            tail = result.then(
                () => undefined,
                () => undefined,
            );
            return result;
        };
        const [x, y] = inRoot(() => [
            createSavedValue(() => 0, async (v) => {
                log.push(`x=${v}`);
                await gate.promise;
            }, { queue }),
            createSavedValue(() => 0, async (v) => void log.push(`y=${v}`), { queue }),
        ]);
        const saves = [x.set(1), queue(async () => void log.push("work")), y.set(2)];
        await flush();
        expect(log).toEqual(["x=1"]);
        gate.resolve();
        await Promise.all(saves);
        expect(log).toEqual(["x=1", "work", "y=2"]);
    });

    test("on a PaperToggle the switch flips at the press, stays usable while saving, and flips back when the save fails", async () => {
        const turn = deferred();
        let failure: unknown = null;
        const view = render(() => {
            const saved = createSavedValue(() => false, () => turn.promise);
            return <PaperToggle aria-label="Whitelist" checked={saved.value()} onChange={(on) => saved.set(on).catch((err) => (failure = err))} />;
        });
        const toggle = view.getByRole("switch", { name: "Whitelist" });
        fireEvent.click(toggle);
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        expect(toggle.getAttribute("aria-disabled")).toBeNull();
        turn.reject(new Error("The server is starting"));
        await flush();
        expect(toggle.getAttribute("aria-checked")).toBe("false");
        expect(failure).toEqual(new Error("The server is starting"));
        view.unmount();
    });
});
