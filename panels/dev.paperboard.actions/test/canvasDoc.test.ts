// The canvas document's owner (bun test): windows save through it with the
// revision their edit was made on, so no window silently writes over another,
// and every accepted save is announced to the others.
import { describe, expect, it } from "bun:test";
import { createCanvasDocument, emptyCanvas, isCanvasConflict, type CanvasDocument } from "../src/lib/canvasDoc";
import { createCanvasFollower } from "../src/lib/canvasSync";

const note = (text: string) => ({ ...emptyCanvas(), notes: [{ id: "n", pos: { x: 0, y: 0 }, text }] });

function owner(stored: unknown = null) {
    let disk: any = stored;
    const changes: { revision: number; clientId: string }[] = [];
    const applied: CanvasDocument[] = [];
    let failApply = false;
    let failRead = false;
    const doc = createCanvasDocument({
        read: async () => {
            if (failRead) throw new Error("disk unreadable");
            return disk;
        },
        write: async (d) => {
            disk = structuredClone(d);
        },
        validate: (c) => c,
        apply: async (c) => {
            if (failApply) throw new Error("trigger subscription failed");
            applied.push(c);
        },
        onChanged: (c) => changes.push(c),
    });
    return {
        doc,
        changes,
        applied,
        disk: () => disk,
        failApply: (v: boolean) => (failApply = v),
        failRead: (v: boolean) => (failRead = v),
    };
}

describe("the canvas document", () => {
    it("saves on the current revision, applies, and announces who saved", async () => {
        const o = owner();
        await o.doc.load();
        expect(await o.doc.save({ canvas: note("a"), baseRevision: 0, clientId: "w1" })).toEqual({ revision: 1 });
        expect(o.disk()).toMatchObject({ revision: 1, notes: [{ text: "a" }] });
        expect(o.applied).toHaveLength(1);
        expect(o.changes).toEqual([{ revision: 1, clientId: "w1" }]);
        expect((await o.doc.get()).revision).toBe(1);
    });

    it("refuses a save made on an older revision instead of overwriting it", async () => {
        const o = owner();
        await o.doc.load();
        await o.doc.save({ canvas: note("first window"), baseRevision: 0, clientId: "w1" });
        const stale = o.doc.save({ canvas: note("second window"), baseRevision: 0, clientId: "w2" });
        await expect(stale).rejects.toThrow();
        expect(isCanvasConflict(await stale.catch((e) => e))).toBe(true);
        expect(o.disk().notes[0].text).toBe("first window");
        expect(o.changes).toHaveLength(1);
    });

    it("serializes saves, so two on the same revision cannot both land", async () => {
        const o = owner();
        await o.doc.load();
        const results = await Promise.allSettled([
            o.doc.save({ canvas: note("a"), baseRevision: 0, clientId: "w1" }),
            o.doc.save({ canvas: note("b"), baseRevision: 0, clientId: "w2" }),
        ]);
        expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
        expect(o.disk().notes[0].text).toBe("a");
    });

    it("keeps the revision across restarts", async () => {
        const first = owner();
        await first.doc.load();
        await first.doc.save({ canvas: note("a"), baseRevision: 0, clientId: "w1" });
        const restarted = owner(first.disk());
        expect((await restarted.doc.load()).revision).toBe(1);
        await expect(restarted.doc.save({ canvas: note("b"), baseRevision: 0, clientId: "w1" })).rejects.toThrow();
    });

    it("reports saved-but-not-applied as that, and still announces the save", async () => {
        const o = owner();
        await o.doc.load();
        o.failApply(true);
        expect(await o.doc.save({ canvas: note("a"), baseRevision: 0, clientId: "w1" })).toEqual({
            revision: 1,
            applyError: "trigger subscription failed",
        });
        expect(o.changes).toEqual([{ revision: 1, clientId: "w1" }]);
    });

    it("never writes over a canvas it could not read, and reads it again on request", async () => {
        const o = owner({ ...note("precious"), revision: 4 });
        o.failRead(true);
        await expect(o.doc.load()).rejects.toThrow(/could not be read/);
        await expect(o.doc.save({ canvas: emptyCanvas(), baseRevision: 0, clientId: "w1" })).rejects.toThrow(/could not be read/);
        expect(o.disk().notes[0].text).toBe("precious");
        o.failRead(false);
        expect(await o.doc.get()).toMatchObject({ revision: 4, canvas: { notes: [{ text: "precious" }] } });
    });
});

describe("a window following other windows", () => {
    function window(serviceRevision: () => number) {
        let revision = 0;
        let busy = false;
        const shown: number[] = [];
        let fetches = 0;
        let release: (() => void) | null = null;
        let hold = false;
        const follower = createCanvasFollower({
            clientId: "me",
            fetch: async () => {
                fetches++;
                // the answer is what the service held when it was asked
                const answer = { revision: serviceRevision() };
                if (hold) await new Promise<void>((r) => (release = r));
                return answer;
            },
            revision: () => revision,
            busy: () => busy,
            show: (s) => {
                revision = s.revision;
                shown.push(s.revision);
            },
            onError: () => {},
        });
        return {
            follower,
            shown,
            fetches: () => fetches,
            setBusy: (v: boolean) => (busy = v),
            setRevision: (v: number) => (revision = v),
            hold: () => (hold = true),
            release: () => {
                hold = false;
                release?.();
            },
        };
    }

    it("pulls a revision another window saved", async () => {
        const w = window(() => 3);
        await w.follower.changed({ revision: 3, clientId: "other" });
        expect(w.shown).toEqual([3]);
    });

    it("ignores its own saves and revisions it already has", async () => {
        const w = window(() => 3);
        await w.follower.changed({ revision: 3, clientId: "me" });
        w.setRevision(3);
        await w.follower.changed({ revision: 3, clientId: "other" });
        expect(w.fetches()).toBe(0);
    });

    it("never replaces unsaved local edits; catches up once they settle", async () => {
        const w = window(() => 2);
        w.setBusy(true);
        await w.follower.changed({ revision: 2, clientId: "other" });
        expect(w.fetches()).toBe(0);
        w.setBusy(false);
        await w.follower.idle();
        expect(w.shown).toEqual([2]);
    });

    it("drops a pulled canvas when an edit started during the pull", async () => {
        const w = window(() => 2);
        w.hold();
        const pulling = w.follower.changed({ revision: 2, clientId: "other" });
        w.setBusy(true);
        w.release();
        await pulling;
        expect(w.shown).toEqual([]);
    });

    it("folds changes during a pull into one more pull, not one per change", async () => {
        let service = 1;
        const w = window(() => service);
        w.hold();
        const first = w.follower.changed({ revision: 1, clientId: "other" });
        service = 5;
        for (let r = 2; r <= 5; r++) void w.follower.changed({ revision: r, clientId: "other" });
        w.release();
        await first;
        expect(w.fetches()).toBe(2);
        expect(w.shown).toEqual([1, 5]);
    });

    it("reloads after a refused save even without a newer announcement", async () => {
        const w = window(() => 7);
        w.setRevision(0);
        await w.follower.reload();
        expect(w.shown).toEqual([7]);
    });
});
