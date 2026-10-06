import { expect, test } from "bun:test";
import { createCanvasSync, type CanvasSyncState } from "../src/lib/canvasSync";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

test("a delayed old save cannot overwrite or activate ahead of the latest canvas", async () => {
    const blocked = deferred();
    const calls: string[] = [];
    const sync = createCanvasSync<{ id: string }>({
        delayMs: 60_000,
        save: async ({ id }) => { calls.push(`save:${id}`); if (id === "old") await blocked.promise; },
        apply: async ({ id }) => { calls.push(`apply:${id}`); },
        onState: () => {},
    });
    try {
        sync.schedule({ id: "old" });
        const pending = sync.flush();
        const edit = { id: "new" };
        sync.schedule(edit);
        edit.id = "mutated";
        expect(calls).toEqual(["save:old"]);
        blocked.resolve();
        expect(await pending).toEqual({ ok: true });
        expect(calls).toEqual(["save:old", "save:new", "apply:new"]);
    } finally { blocked.resolve(); sync.dispose(); }
});

test("saved is distinct from applied; retry applies the first flow without creating a second", async () => {
    let unavailable = true;
    const states: CanvasSyncState[] = [];
    const calls: string[] = [];
    const sync = createCanvasSync<string>({
        delayMs: 60_000,
        save: async (snapshot) => { calls.push(`save:${snapshot}`); },
        apply: async (snapshot) => {
            if (unavailable) throw new Error("service unavailable");
            calls.push(`apply:${snapshot}`);
        },
        onState: (state) => states.push(state),
    });
    try {
        sync.schedule("first-flow");
        expect((await sync.flush()).ok).toBe(false);
        expect(states.at(-1)).toEqual({ status: "error", message: "Canvas saved, but flows were not applied: service unavailable" });
        unavailable = false;
        expect(await sync.flush()).toEqual({ ok: true });
        expect(calls).toEqual(["save:first-flow", "save:first-flow", "apply:first-flow"]);
        expect(states.at(-1)).toEqual({ status: "applied" });
    } finally { sync.dispose(); }
});

test("a failed save never applies, and closing cancels pending sync", async () => {
    let applied = false;
    const sync = createCanvasSync<string>({
        save: async () => { throw new Error("disk unavailable"); },
        apply: async () => { applied = true; },
        onState: () => {},
    });
    try {
        sync.schedule("first-flow");
        expect(await sync.flush()).toEqual({ ok: false, message: "Canvas could not be saved: disk unavailable" });
        expect(applied).toBe(false);
        sync.schedule("pending");
        sync.dispose();
        expect((await sync.flush()).ok).toBe(false);
    } finally { sync.dispose(); }
});

test("closing during a save prevents applying it and emitting later UI state", async () => {
    const blocked = deferred();
    let applied = false;
    const states: CanvasSyncState[] = [];
    const sync = createCanvasSync<string>({
        save: () => blocked.promise,
        apply: async () => { applied = true; },
        onState: (state) => states.push(state),
    });
    try {
        sync.schedule("first-flow");
        const pending = sync.flush();
        sync.dispose();
        const count = states.length;
        blocked.resolve();
        expect((await pending).ok).toBe(false);
        expect(applied).toBe(false);
        expect(states.length).toBe(count);
    } finally { blocked.resolve(); sync.dispose(); }
});
