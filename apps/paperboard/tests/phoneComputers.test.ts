// The phone layout hides This Computer and opens on a welcome page until a
// computer is paired; the desktop lists every computer and never shows it.
import { describe, it, expect } from "bun:test";
import { shownComputers, showsWelcome } from "../src/renderer/src/lib/phoneComputers";

const local = { id: "local", isLocal: true };
const nas = { id: "nas" };

describe("phone computers", () => {
    it("a phone lists only paired computers; the desktop lists them all", () => {
        expect(shownComputers([local, nas], true)).toEqual([nas]);
        expect(shownComputers([local, nas], false)).toEqual([local, nas]);
    });

    it("a phone with nothing paired opens on the welcome page", () => {
        expect(showsWelcome([local], true)).toBe(true);
        expect(showsWelcome([local, nas], true)).toBe(false);
        expect(showsWelcome([local], false)).toBe(false);
    });
});
