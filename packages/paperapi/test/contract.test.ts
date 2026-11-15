import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "../src/blocks";
import { defineContract, serviceClient, shape, type ServiceClient } from "../src/contract";
import { closeTransport, getTransport } from "../src/ipc";
import { callBlockId } from "../src/serviceCalls";
import { NOTES, notesContract } from "./helpers/contract";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

setDefaultTimeout(60_000);

// the page (this test process) and the panel's service (a child process)
// share one contract, through the real daemon
let daemon: Daemon;
let panel: PanelProcess;
let service: ServiceClient<typeof notesContract>;
// what a caller without the contract's types sends: the CLI, an agent, a stale page
const untyped = (name: string, input: unknown) => blocksApi.run(NOTES, callBlockId(name), { input });

beforeAll(async () => {
    daemon = await startDaemon();
    panel = await daemon.startPanel(NOTES, "notes");
    service = serviceClient(notesContract, { book: "groceries" });
});

afterAll(async () => {
    service.state.dispose();
    await panel.stop();
    closeTransport();
    await daemon.stop();
});

describe("a panel's contract", () => {
    test("the page calls by the contract's names in its scope, hears its events and mirrors its state", async () => {
        let heard!: (text: string) => void;
        const first = new Promise<string>((resolve) => (heard = resolve));
        const off = service.events.noteAdded((note) => heard(note.text));
        let mirrored!: (last: string | null) => void;
        const changed = new Promise<string | null>((resolve) => (mirrored = resolve));
        const offState = service.state.subscribe((state) => state.last && mirrored(state.last));
        expect(service.state.current()).toEqual({ count: 0, last: null });
        await service.state.refresh();
        await getTransport().subscriptionsSettled();
        const added = await service.calls.addNote({ text: "milk" });
        expect(added).toEqual({ id: "n1", book: "groceries", text: "milk", pinned: false });
        expect(await service.calls.listNotes()).toEqual([added]);
        expect(await serviceClient(notesContract, { book: "chores" }).calls.listNotes()).toEqual([]);
        expect(await changed).toBe("milk");
        expect(service.state.current()).toEqual({ count: 1, last: "milk" });
        offState();
        // a call that gives nothing back is undefined on the page, not null
        expect(await service.calls.clear()).toBeUndefined();
        expect(await first).toBe("milk");
        off();
    });

    test("an input that breaks its shape is refused before the handler runs, naming the call and the field", async () => {
        const before = await service.calls.handlerRuns();
        await expect(untyped("addNote", { text: "eggs" })).rejects.toThrow('The call "addNote" was refused: the field "book" is missing');
        await expect(untyped("addNote", { book: "b", text: 42 })).rejects.toThrow('The call "addNote" was refused: the field "text": expected text, got number 42');
        await expect(untyped("addNote", { book: "b" })).rejects.toThrow('The call "addNote" was refused: the field "text" is missing');
        await expect(untyped("addNote", { book: "b", text: "eggs", pinnd: true })).rejects.toThrow('The call "addNote" was refused: there is no field "pinnd"');
        await expect(untyped("listNotes", { book: "b", all: true })).rejects.toThrow('The call "listNotes" was refused: there is no field "all"');
        expect(await service.calls.handlerRuns()).toBe(before);
    });

    test("an answer or a state change that breaks its shape never reaches the page", async () => {
        await expect(service.calls.brokenAnswer()).rejects.toThrow('The call "brokenAnswer" answered what its contract doesn\'t say: the field "text": expected text, got number 7');
        await expect(service.calls.brokenState()).rejects.toThrow('The state was not changed: the field "count": expected a number, got the text "many"');
        expect((await service.state.refresh()).count).toBe(1);
    });

    test("the page waits for a call as long as its contract says", async () => {
        await expect(service.calls.held()).rejects.toThrow("timed out");
        await service.calls.release();
    });

    test("a name the contract doesn't have is a type error, and nothing to call", () => {
        // @ts-expect-error not a call of the contract
        expect(service.calls.removeNote).toBeUndefined();
        // @ts-expect-error not an event of the contract
        expect(service.events.noteRemoved).toBeUndefined();
    });

    test("a contract that can't travel is refused when it is made", () => {
        expect(() =>
            defineContract("dev.test.clash", { calls: { renameTab: { output: shape.nothing() }, "rename-tab": { output: shape.nothing() } } }),
        ).toThrow('The calls "renameTab" and "rename-tab" of dev.test.clash share the name call-rename-tab');
        expect(() =>
            defineContract("dev.test.clash", { scope: { server: shape.text() }, calls: { kick: { input: shape.object({ server: shape.text() }), output: shape.nothing() } } }),
        ).toThrow('The call "kick" of dev.test.clash names "server", which its scope already gives');
        expect(() =>
            // @ts-expect-error the initial state is not the state's shape
            defineContract("dev.test.clash", { state: { shape: shape.object({ count: shape.number() }), initial: { count: "0" } } }),
        ).toThrow('The initial state of dev.test.clash\'s contract is wrong: the field "count": expected a number, got the text "0"');
    });
});

describe("shapes", () => {
    const tab = shape.object({
        id: shape.text(),
        layout: shape.oneOf("horizontal", "vertical"),
        split: shape.optional(shape.object({ direction: shape.oneOf("right", "down") })),
        cwd: shape.nullable(shape.text()),
        sizes: shape.list(shape.number()),
        live: shape.record(shape.either(shape.object({ deleted: shape.text() }), shape.object({ refused: shape.text() }))),
    });
    const good = { id: "t1", layout: "vertical", cwd: null, sizes: [1, 2], live: { a: { deleted: "x" } } };
    const problem = (value: unknown, strict = true) => tab.check(value, "", strict);

    test("each part of a value is checked where it sits", () => {
        expect(problem(good)).toBeNull();
        expect(problem({ ...good, layout: "diagonal" })).toBe('the field "layout": expected "horizontal" or "vertical", got the text "diagonal"');
        expect(problem({ ...good, split: { direction: "up" } })).toBe('the field "split.direction": expected "right" or "down", got the text "up"');
        expect(problem({ ...good, sizes: [1, "2"] })).toBe('the field "sizes[1]": expected a number, got the text "2"');
        expect(problem({ ...good, live: { a: {} } })).toBe('the field "live.a.deleted" is missing, or the field "live.a.refused" is missing');
        expect(problem({ ...good, cwd: undefined })).toBe('the field "cwd" is missing');
    });

    test("a value given to a call may not carry a field its shape doesn't name; an answer may", () => {
        expect(problem({ ...good, extra: 1 })).toBe('there is no field "extra"');
        expect(problem({ ...good, split: { direction: "down", ratio: 0.5 } })).toBe('there is no field "split.ratio"');
        expect(problem({ ...good, extra: 1 }, false)).toBeNull();
    });
});
