// The sidebar selection race: the created conversation's summary event can
// arrive after the creating call's answer. This is the exact ordering that
// sent the highlight to another chat and made clicking it a no-op; the rule
// is pure, so the ordering is a table test.
import { describe, it, expect, mock } from "bun:test";
import { nextSelection } from "../src/core/selection";

// bun resolves solid-js to its SSR build, where effects never run. The
// selection machine is a reactive effect; run this file against the real
// reactive build so the ordering under test is the ordering the panel gets.
mock.module("solid-js", () => import("solid-js/dist/dev.js"));
const { createRoot, createSignal } = await import("solid-js");
const { createChatSelection } = await import("../src/lib/selection");

describe("chat list selection", () => {
    it("holds the freshly created chat while its summary is in flight", () => {
        // send() created "c" and set it selected; the mirror still lacks it
        expect(
            nextSelection({ selected: "c", pending: "c" }, ["a", "b"]),
        ).toBeNull();
    });

    it("releases the hold when the summary arrives", () => {
        expect(
            nextSelection({ selected: "c", pending: "c" }, ["c", "a", "b"]),
        ).toEqual({ selected: "c", pending: null });
    });

    it("keeps the selection when it is mirrored", () => {
        expect(nextSelection({ selected: "b", pending: null }, ["a", "b"])).toBeNull();
    });

    it("falls back to the newest chat when the selected one is gone", () => {
        expect(nextSelection({ selected: "b", pending: null }, ["a"])).toEqual({
            selected: "a",
            pending: null,
        });
    });

    it("selects the newest chat when nothing is selected", () => {
        expect(nextSelection({ selected: null, pending: null }, ["a", "b"])).toEqual({
            selected: "a",
            pending: null,
        });
        expect(nextSelection({ selected: null, pending: null }, [])).toBeNull();
    });

    it("clears a selection that no longer has a list to live in", () => {
        expect(nextSelection({ selected: "a", pending: null }, [])).toEqual({
            selected: null,
            pending: null,
        });
    });

    it("a user click cancels a hold on a chat that never arrived", () => {
        // selectChat clears pending; the click's own chat is mirrored
        expect(nextSelection({ selected: "a", pending: null }, ["a", "b"])).toBeNull();
    });

    it("settles to no-ops once applied", () => {
        const first = nextSelection({ selected: null, pending: null }, ["a", "b"]);
        expect(first).toEqual({ selected: "a", pending: null });
        expect(nextSelection(first!, ["a", "b"])).toBeNull();
    });
});

describe("chat selection machine", () => {
    // The machine is created inside a root so its effect runs; calls and
    // assertions happen after, when each setter has flushed its effects.

    it("keeps the new chat selected through the summary lag", () => {
        const [list, setList] = createSignal<string[]>([]);
        const selection = createRoot(() => createChatSelection(list));
        selection.newChat();
        expect(selection.draft()).toBe(true);

        // the creating call answered before the summary event arrived
        selection.created("c");
        expect(selection.selected()).toBe("c");
        expect(selection.draft()).toBe(false);
        expect(selection.pending()).toBe("c");

        // the summary event lands: the hold releases, the selection stays
        setList(["c", "a"]);
        expect(selection.pending()).toBeNull();
        expect(selection.selected()).toBe("c");

        // later list churn never steals it
        setList(["b", "c", "a"]);
        expect(selection.selected()).toBe("c");
    });

    it("does not hold when the summary beat the answer", () => {
        const [list] = createSignal<string[]>(["c", "a"]);
        const selection = createRoot(() => createChatSelection(list));
        selection.newChat();
        selection.created("c");
        expect(selection.pending()).toBeNull();
        expect(selection.selected()).toBe("c");
    });

    it("falls back to the newest chat when the selected one is deleted", () => {
        const [list, setList] = createSignal<string[]>(["a", "b"]);
        const selection = createRoot(() => createChatSelection(list));
        selection.select("b");
        expect(selection.selected()).toBe("b");
        setList(["a"]);
        expect(selection.selected()).toBe("a");
    });

    it("a user click wins over a pending hold", () => {
        const [list, setList] = createSignal<string[]>(["a"]);
        const selection = createRoot(() => createChatSelection(list));
        selection.newChat();
        selection.created("c");
        selection.select("a");
        expect(selection.selected()).toBe("a");
        expect(selection.pending()).toBeNull();
        setList(["c", "a"]);
        expect(selection.selected()).toBe("a");
    });
});
