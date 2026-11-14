// Every switch and menu that saves a setting goes through lib/saves: it flips
// at once, saves in order, falls back and says why when a save fails, and
// follows what is stored once its saves are done.
import { describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { createSaves } from "../src/lib/saves";

/** a save that finishes when the test says */
function gate() {
    let open!: () => void;
    let fail!: (err: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
        open = resolve;
        fail = reject;
    });
    return { done, open, fail };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** a tab whose stored settings change only when a save's answer says so */
function tab(stored: Record<string, unknown>) {
    return createRoot((dispose) => {
        const [disk, setDisk] = createSignal<Record<string, unknown>>(stored);
        const failures: { key: string; value: unknown; message: string }[] = [];
        let cleared = 0;
        const saves = createSaves({
            failed: (err, key, value) => failures.push({ key, value, message: (err as Error).message }),
            changed: () => cleared++,
        });
        const writes: { key: string; value: unknown }[] = [];
        const setting = <T,>(key: string, wait?: () => Promise<void>) =>
            saves.setting<T>(key, () => disk()[key] as T, async (value) => {
                writes.push({ key, value });
                await wait?.();
                setDisk((prev) => ({ ...prev, [key]: value }));
            });
        return { saves, setting, disk, setDisk, writes, failures, cleared: () => cleared, dispose };
    });
}

describe("a setting's saves", () => {
    test("two quick changes of two settings both land, one after the other", async () => {
        const t = tab({ crash: false, update: false });
        const first = gate();
        const crash = t.setting<boolean>("crash", () => first.done);
        const update = t.setting<boolean>("update");
        crash.set(true);
        update.set(true);
        // both show at once, before either is saved
        expect([crash.value(), update.value()]).toEqual([true, true]);
        expect(crash.saving() && update.saving()).toBe(true);
        await tick();
        // the second waits for the first
        expect(t.writes).toEqual([{ key: "crash", value: true }]);
        first.open();
        await tick();
        await tick();
        expect(t.writes).toEqual([{ key: "crash", value: true }, { key: "update", value: true }]);
        expect(t.disk()).toEqual({ crash: true, update: true });
        expect([crash.value(), update.value(), crash.saving(), update.saving()]).toEqual([true, true, false, false]);
        t.dispose();
    });

    test("a change made while the same setting saves is the one that ends up saved", async () => {
        const t = tab({ every: 24 });
        const first = gate();
        let calls = 0;
        const every = t.setting<number>("every", () => (++calls === 1 ? first.done : Promise.resolve()));
        every.set(12);
        // 12 is saving when the next two are made
        await tick();
        every.set(6);
        every.set(3);
        expect(every.value()).toBe(3);
        first.open();
        await tick();
        await tick();
        // the middle change was replaced before its turn and never written
        expect(t.writes.map((w) => w.value)).toEqual([12, 3]);
        expect(t.disk().every).toBe(3);
        expect(every.value()).toBe(3);
        t.dispose();
    });

    test("a failed save falls back to what is stored and is reported", async () => {
        const t = tab({ crash: false });
        const first = gate();
        const crash = t.setting<boolean>("crash", () => first.done);
        crash.set(true);
        expect(crash.value()).toBe(true);
        expect(t.cleared()).toBe(1);
        first.fail(new Error("disk full"));
        await tick();
        await tick();
        expect(crash.value()).toBe(false);
        expect(crash.saving()).toBe(false);
        expect(t.failures).toEqual([{ key: "crash", value: true, message: "disk full" }]);
        t.dispose();
    });

    test("a failure a newer change carries on is reported, and the newer change still shows", async () => {
        const t = tab({ keep: 7 });
        const first = gate();
        const second = gate();
        let calls = 0;
        const keep = t.setting<number>("keep", () => (++calls === 1 ? first.done : second.done));
        keep.set(5);
        await tick();
        keep.set(3);
        first.fail(new Error("busy"));
        await tick();
        expect(t.failures.map((f) => f.value)).toEqual([5]);
        expect(keep.value()).toBe(3);
        second.open();
        await tick();
        await tick();
        expect(keep.value()).toBe(3);
        expect(t.disk().keep).toBe(3);
        t.dispose();
    });

    test("a save that lands shows its value until what is stored catches up, then follows it", async () => {
        const t = createRoot((dispose) => {
            const [stored, setStored] = createSignal("false");
            const saves = createSaves({ failed: (err) => { throw err; } });
            // the service answers at once; the new value arrives later, as a push does
            const rule = saves.setting("keep_inventory", stored, async () => {});
            return { stored, setStored, rule, dispose };
        });
        t.rule.set("true");
        await tick();
        expect(t.rule.saving()).toBe(false);
        expect(t.rule.value()).toBe("true");
        // the push brings it
        t.setStored("true");
        expect(t.rule.value()).toBe("true");
        // and a later change elsewhere (an in-game command) is shown
        t.setStored("false");
        expect(t.rule.value()).toBe("false");
        t.dispose();
    });

    test("a change the user called off shows what is stored, without a failure", async () => {
        const t = createRoot((dispose) => {
            const failures: unknown[] = [];
            const saves = createSaves({ failed: (err) => failures.push(err) });
            const routine = saves.setting<number | null>("schedule", () => null, async () => false);
            return { routine, failures, dispose };
        });
        t.routine.set(24);
        expect(t.routine.value()).toBe(24);
        await tick();
        expect(t.routine.value()).toBe(null);
        expect(t.failures).toEqual([]);
        t.dispose();
    });

    test("other work waits its turn behind the saves", async () => {
        const t = tab({ on: false });
        const first = gate();
        const on = t.setting<boolean>("on", () => first.done);
        const order: string[] = [];
        on.set(true);
        const upload = t.saves.run(async () => {
            order.push(`upload sees ${String(t.disk().on)}`);
        });
        expect(t.saves.saving()).toBe(true);
        first.open();
        await upload;
        expect(order).toEqual(["upload sees true"]);
        expect(t.saves.saving()).toBe(false);
        t.dispose();
    });
});
