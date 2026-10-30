// App Settings' "Start on": Paperboard opens on Home or on a chosen
// computer's panel list, and a computer that's gone opens Home.
import { describe, it, expect } from "bun:test";
import { START_ON_HOME, startTarget } from "../src/renderer/src/lib/startOn";

const computers = [{ id: "local" }, { id: "nas" }];

describe("start on", () => {
    it("opens Home when Home is chosen", () => {
        expect(startTarget(START_ON_HOME, computers)).toEqual({ computerId: null, missing: false });
    });

    it("opens the chosen computer", () => {
        expect(startTarget("nas", computers)).toEqual({ computerId: "nas", missing: false });
        expect(startTarget("local", computers)).toEqual({ computerId: "local", missing: false });
    });

    it("a computer that's no longer listed opens Home and says so", () => {
        expect(startTarget("gone", computers)).toEqual({ computerId: null, missing: true });
    });
});
