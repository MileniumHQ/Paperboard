// A host without This Computer (bun test): its rail and Home never draw from
// the placeholder list that holds This Computer.
import { describe, expect, it } from "bun:test";
import { computerAfterRemoval, showsNoComputers } from "../../src/renderer/src/lib/hostComputers";
import { glanceComputerId } from "../../src/renderer/src/lib/homeLayout";

describe("a host's empty state", () => {
    it("covers the placeholder list until the real one arrives, then only an empty one", () => {
        expect(showsNoComputers(true, false, 1)).toBe(true);
        expect(showsNoComputers(true, true, 0)).toBe(true);
        expect(showsNoComputers(true, true, 1)).toBe(false);
    });

    it("never shows on the desktop, which has This Computer", () => {
        expect(showsNoComputers(false, false, 1)).toBe(false);
        expect(showsNoComputers(false, true, 0)).toBe(false);
    });
});

describe("after removing a computer", () => {
    it("shows This Computer when the host has one", () => {
        expect(computerAfterRemoval([{ id: "a" }, { id: "local", isLocal: true }])?.id).toBe("local");
    });

    it("shows a computer that exists on a host without This Computer", () => {
        expect(computerAfterRemoval([{ id: "b" }, { id: "c" }])?.id).toBe("b");
        expect(computerAfterRemoval([])).toBeUndefined();
    });
});

describe("a Home never arranged", () => {
    it("shows this computer, or on a host without one, the first computer it lists", () => {
        const remote = { id: "remote-1" };
        expect(glanceComputerId([remote, { id: "local", isLocal: true }])).toBe("local");
        expect(glanceComputerId([remote, { id: "remote-2" }])).toBe("remote-1");
    });
});
