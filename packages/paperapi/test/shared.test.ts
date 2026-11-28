import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { closeTransport } from "../src/ipc";
import { sharedApi, SHARED_DOCUMENT_MAX_BYTES, type SharedSnapshot } from "../src/shared";
import { startDaemon, type Daemon } from "./helpers/daemon";

setDefaultTimeout(60_000);

const PANEL = "dev.test.shared";
let daemon: Daemon;

beforeAll(async () => {
    daemon = await startDaemon();
});

afterAll(async () => {
    closeTransport();
    await daemon.stop();
});

interface Note {
    text: string;
}

function readNote(value: unknown): Note {
    if (!value || typeof value !== "object" || typeof (value as { text?: unknown }).text !== "string") throw new Error("it isn't a note");
    return { text: (value as { text: string }).text };
}

/** what a watch has heard, and a wait for the next thing it hears */
function heard<T>() {
    const snapshots: SharedSnapshot<T>[] = [];
    const errors: unknown[] = [];
    let waiting: ((s: SharedSnapshot<T>) => void) | null = null;
    return {
        snapshots,
        errors,
        listener: (s: SharedSnapshot<T>) => {
            snapshots.push(s);
            waiting?.(s);
            waiting = null;
        },
        onError: (err: unknown) => errors.push(err),
        next: (count: number) =>
            new Promise<SharedSnapshot<T>>((resolve, reject) => {
                if (snapshots.length >= count) return resolve(snapshots[count - 1]!);
                const timer = setTimeout(() => reject(new Error(`the watch heard ${snapshots.length} snapshots, not ${count}`)), 10_000);
                waiting = (s) => {
                    clearTimeout(timer);
                    resolve(s);
                };
            }),
    };
}

describe("sharedApi", () => {
    test("a watch hears the documents now, then each change, read by the panel's reader", async () => {
        const notes = sharedApi.panel(PANEL, readNote);
        const watch = heard<Note>();
        const stop = notes.watch(watch.listener, watch.onError, { prefix: "notes/" });
        const first = await watch.next(1);
        expect(first).toEqual({ documents: [], changes: [] });

        const written = await notes.set("notes/a", { text: "one" }, { basedOn: null });
        expect(written.overwrote).toBeNull();
        const second = await watch.next(2);
        expect(second.documents.map((d) => d.state === "value" && d.value.text)).toEqual(["one"]);
        expect(second.changes).toEqual([{ id: "notes/a", document: written.document }]);
        expect(written.document.author.self).toBe(true);

        // outside the prefix: not heard
        await notes.set("settings", { text: "elsewhere" });
        // a value the reader refuses is unreadable, with its reason
        await sharedApi.panel(PANEL, (v) => v).set("notes/b", { other: true });
        const third = await watch.next(3);
        expect(third.changes.map((c) => [c.id, c.document?.state])).toEqual([["notes/b", "unreadable"]]);
        const b = third.documents.find((d) => d.id === "notes/b");
        expect(b?.state === "unreadable" && b.error).toBe("it isn't a note");

        await notes.delete("notes/b");
        const fourth = await watch.next(4);
        expect(fourth.changes).toEqual([{ id: "notes/b", document: null }]);
        expect(fourth.documents.map((d) => d.id)).toEqual(["notes/a"]);

        stop();
        await notes.set("notes/c", { text: "after" });
        expect((await notes.list({ prefix: "notes/" })).map((d) => d.id)).toEqual(["notes/a", "notes/c"]);
        expect(watch.snapshots.length).toBe(4);
        expect(watch.errors).toEqual([]);
    });

    test("a set based on an older version wins and names what it overwrote", async () => {
        const notes = sharedApi.panel(PANEL, readNote);
        const read = (await notes.set("draft", { text: "first" })).document;
        // another window's save lands first
        await notes.set("draft", { text: "other window" }, { basedOn: read.version });
        const mine = await notes.set("draft", { text: "mine" }, { basedOn: read.version });
        expect(mine.overwrote?.state === "value" && mine.overwrote.value).toEqual({ text: "other window" });
        expect((await notes.get("draft"))?.state === "value").toBe(true);
        expect((await notes.versions("draft")).length).toBe(1);
    });

    test("what the daemon would refuse is refused before it is sent", async () => {
        const notes = sharedApi.panel(PANEL, (v) => v);
        await expect(notes.set("big", "x".repeat(SHARED_DOCUMENT_MAX_BYTES))).rejects.toThrow(`at most ${SHARED_DOCUMENT_MAX_BYTES}`);
        await expect(notes.set("nothing", undefined)).rejects.toThrow("delete() removes one");
        await expect(notes.get("../escape")).rejects.toThrow("Invalid shared document id");
        await expect(notes.set("x", 1, { basedOn: "nope" })).rejects.toThrow("basedOn");
        expect(() => sharedApi.panel("@roster", (v) => v)).toThrow("Invalid panel id");
    });

    test("the shell's own settings are apart from every panel's", async () => {
        const shell = sharedApi.shell((v) => v);
        await shell.set("draft", "the shell's");
        const panel = await sharedApi.panel(PANEL, readNote).get("draft");
        expect(panel?.state === "value" && panel.value).toEqual({ text: "mine" });
        expect((await shell.get("draft"))?.state === "value" && (await shell.get("draft"))).toMatchObject({ value: "the shell's" });
    });
});
