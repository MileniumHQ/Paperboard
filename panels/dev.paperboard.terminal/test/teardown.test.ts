// subscription teardown (bun test): closing a tab deallocates the session
// id AND detaches the listeners — guarded-not-deallocated is not teardown
import { describe, it, expect } from "bun:test";
import {
    subscribeSession,
    unsubscribeSession,
    __terminalTestState,
} from "../src/service";

describe("session subscription teardown", () => {
    it("unsubscribeSession removes the id so dead tabs stay dead", () => {
        // without a transport the listeners log-and-skip, but the id is
        // still tracked — exactly the leak the fix closes
        subscribeSession("tab_ghost", null);
        expect(__terminalTestState().isSubscribed("tab_ghost")).toBe(true);
        unsubscribeSession("tab_ghost");
        expect(__terminalTestState().isSubscribed("tab_ghost")).toBe(false);
    });

    it("unsubscribe is idempotent and never throws", () => {
        expect(() => unsubscribeSession("tab_never_existed")).not.toThrow();
        expect(__terminalTestState().isSubscribed("tab_never_existed")).toBe(false);
    });
});

// wrong-target refusals (bun test): an unknown or stale tab id must throw,
// never fall back to another session — keystrokes going to the wrong shell
// is the worst silent success a terminal can produce
import { resolveTabIdPure } from "../src/service";

describe("resolveTabId refuses unknown targets", () => {
    const tabs = [
        { id: "tab_a", name: "A" },
        { id: "tab_b", name: "B" },
    ] as any;

    it("resolves a known id", () => {
        expect(resolveTabIdPure("tab_a", tabs)).toBe("tab_a");
    });

    it("refuses an unknown id instead of silently targeting lastActive", () => {
        expect(() => resolveTabIdPure("tab_ghost", tabs)).toThrow(/Unknown terminal tab/);
    });

    it("refuses an empty id instead of silently targeting the first tab", () => {
        expect(() => resolveTabIdPure("", tabs)).toThrow(/tab id required/);
        expect(() => resolveTabIdPure(undefined, tabs)).toThrow(/tab id required/);
    });
});
