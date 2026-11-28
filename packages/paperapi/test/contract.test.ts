import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "../src/blocks";
import { defineContract, serviceClient, type ServiceClient } from "../src/contract";
import { shape } from "../src/shape";
import { closeTransport, getTransport } from "../src/ipc";
import { STATE_EVENT } from "../src/serviceCalls";
import { hydratePanelBridges } from "../src/panelHydration";
import { NOTES, notesContract } from "./helpers/contract";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

setDefaultTimeout(60_000);

// the page (this test process) and the panel's service (a child process)
// share one contract, through the real daemon
let daemon: Daemon;
let panel: PanelProcess;
let service: ServiceClient<typeof notesContract>;

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

    test("a client's state is mirrored from the moment it is made, shared by every client of the panel", async () => {
        const now = await service.state.refresh();
        // made and never read: the shell's readiness check still reads it
        const other = serviceClient(notesContract, { book: "chores" });
        await hydratePanelBridges(NOTES);
        expect(other.state.current()).toEqual(now);
        // a client that lets go stops only its own subscribers
        let heardOther = 0;
        let heardMine = 0;
        other.state.subscribe(() => heardOther++);
        const off = service.state.subscribe(() => heardMine++);
        other.state.dispose();
        await service.state.refresh();
        off();
        expect({ heardMine, heardOther }).toEqual({ heardMine: 1, heardOther: 0 });
    });

    test("the page waits for a call as long as its contract says", async () => {
        await expect(service.calls.held()).rejects.toThrow("timed out");
        await service.calls.release();
    });

    test("a contract can't make the page wait longer than the daemon lets a call wait", () => {
        const waiting = (timeoutMs: number | null) => () => defineContract("dev.paperboard.waits", { calls: { slow: { output: shape.text(), timeoutMs } } });
        expect(waiting(300_000)).toThrow('The call "slow" of dev.paperboard.waits waits 300000 ms, over the 60000 ms a call can wait; use null for work that runs longer');
        expect(waiting(60_000)).not.toThrow();
        expect(waiting(null)).not.toThrow();
    });

    test("a name the contract doesn't have is a type error, and nothing to call", () => {
        // @ts-expect-error not a call of the contract
        expect(service.calls.removeNote).toBeUndefined();
        // @ts-expect-error not an event of the contract
        expect(service.events.noteRemoved).toBeUndefined();
    });

    test("keyed state travels one key at a time: the page reads and follows the keys it shows", async () => {
        const chores = serviceClient(notesContract, { book: "chores" });
        const drafts = service.keyed.drafts;
        // what each push carried, as the wire has it
        const pushed: unknown[] = [];
        const offWire = blocksApi.onEvent(NOTES, STATE_EVENT, (payload) => payload.keyed && pushed.push(payload.keyed));
        const heard: unknown[] = [];
        let landed!: () => void;
        const twoHeard = new Promise<void>((resolve) => (landed = resolve));
        const off = drafts.follow("groceries")((draft) => {
            heard.push(draft);
            if (heard.length === 2) landed();
        });
        // the same follow shape PaperUI's createRead takes
        const follow: (land: (change: { text: string; words: number } | undefined | ((prev: unknown) => unknown)) => void) => () => void = drafts.follow("groceries");
        expect(typeof follow).toBe("function");
        await getTransport().subscriptionsSettled();
        expect(await drafts.read("groceries")).toBeUndefined();
        await service.calls.draft({ text: "milk and eggs" });
        await chores.calls.draft({ text: "sweep" });
        expect(await drafts.read("groceries")).toEqual({ text: "milk and eggs", words: 3 });
        expect(await chores.keyed.drafts.read("chores")).toEqual({ text: "sweep", words: 1 });
        expect(await drafts.readAll()).toEqual({ groceries: { text: "milk and eggs", words: 3 }, chores: { text: "sweep", words: 1 } });
        await service.calls.discardDraft();
        await twoHeard;
        // the other notebook's draft never reached this key's follower
        expect(heard).toEqual([{ text: "milk and eggs", words: 3 }, undefined]);
        expect(await drafts.read("groceries")).toBeUndefined();
        expect(await drafts.readAll()).toEqual({ chores: { text: "sweep", words: 1 } });
        // a key's value its shape refuses never leaves the service
        await expect(service.calls.brokenDraft()).rejects.toThrow('The keyed state "drafts" was not changed: the field "drafts.groceries.words": expected a number, got the text "one"');
        expect(await drafts.read("groceries")).toBeUndefined();
        off();
        await chores.calls.discardDraft();
        offWire();
        // each push carried the one key that changed, never the others
        for (const push of pushed) expect(Object.keys((push as { drafts: object }).drafts)).toHaveLength(1);
    });
});
