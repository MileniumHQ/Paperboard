import { describe, expect, test } from "bun:test";
import { createSaveQueue } from "../../src/renderer/src/lib/saveQueue";

// App settings are saved through this queue: two quick changes must both
// end up on disk, in the order they were made, whichever way a save goes.
describe("the settings save queue", () => {
    const gate = () => {
        let open!: () => void;
        let fail!: (err: Error) => void;
        const done = new Promise<void>((resolve, reject) => {
            open = resolve;
            fail = reject;
        });
        return { done, open, fail };
    };

    test("a second change made while the first is saving keeps the first", async () => {
        const saves = createSaveQueue();
        let shown = { theme: "system", startOn: "home" };
        const disk: (typeof shown)[] = [];
        const first = gate();
        // each change is built from what shows, the way App Settings builds it
        const change = (next: Partial<typeof shown>, slow?: Promise<void>) => {
            const value = { ...shown, ...next };
            shown = value;
            return saves(async () => {
                await slow;
                disk.push(value);
            });
        };
        const a = change({ theme: "dark" }, first.done);
        const b = change({ startOn: "local" });
        first.open();
        await Promise.all([a, b]);
        expect(disk).toEqual([
            { theme: "dark", startOn: "home" },
            { theme: "dark", startOn: "local" },
        ]);
    });

    test("saves run one at a time, and a save knows a newer one is waiting", async () => {
        const saves = createSaveQueue();
        const order: string[] = [];
        const first = gate();
        let firstSuperseded: boolean | undefined;
        let secondSuperseded: boolean | undefined;
        const a = saves(async (superseded) => {
            order.push("first started");
            await first.done;
            firstSuperseded = superseded();
            order.push("first done");
        });
        const b = saves(async (superseded) => {
            secondSuperseded = superseded();
            order.push("second started");
        });
        await Promise.resolve();
        expect(order).toEqual(["first started"]);
        first.open();
        await Promise.all([a, b]);
        expect(order).toEqual(["first started", "first done", "second started"]);
        expect(firstSuperseded).toBe(true);
        expect(secondSuperseded).toBe(false);
    });

    test("a failed save is its caller's to show, and the saves behind it still run", async () => {
        const saves = createSaveQueue();
        const first = gate();
        const a = saves(() => first.done);
        let ran = false;
        const b = saves(async () => {
            ran = true;
        });
        first.fail(new Error("disk full"));
        await expect(a).rejects.toThrow("disk full");
        await b;
        expect(ran).toBe(true);
    });
});
