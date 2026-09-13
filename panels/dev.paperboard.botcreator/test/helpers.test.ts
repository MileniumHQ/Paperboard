// pure helpers behind the setup error surface and the live recent-message
// feed (bun test): no component tests exist in this repo, so the UI logic
// that must not fail silently is pinned here
import { describe, it, expect } from "bun:test";
import { appendCapped, errorToMessage, RECENT_MESSAGE_CAP } from "../src/types";

describe("errorToMessage", () => {
    it("extracts the message from Error objects", () => {
        expect(errorToMessage(new Error("Invalid token"))).toBe("Invalid token");
    });

    it("stringifies non-Error throwables instead of failing to render", () => {
        expect(errorToMessage("plain failure")).toBe("plain failure");
        expect(errorToMessage({ code: 401 })).toBe("[object Object]");
        expect(errorToMessage(undefined)).toBe("undefined");
    });
});

describe("appendCapped (recent-message bound)", () => {
    it("keeps chronological order and drops the oldest past the cap", () => {
        const list: { id: number }[] = [];
        for (let n = 1; n <= RECENT_MESSAGE_CAP + 3; n++) {
            list.splice(0, list.length, ...appendCapped(list, { id: n }, RECENT_MESSAGE_CAP));
        }
        expect(list).toHaveLength(RECENT_MESSAGE_CAP);
        expect(list[0].id).toBe(4);
        expect(list[list.length - 1].id).toBe(RECENT_MESSAGE_CAP + 3);
    });

    it("leaves short lists untouched", () => {
        expect(appendCapped([{ id: 1 }], { id: 2 })).toHaveLength(2);
    });
});
