// The block library's read (bun test): a failed read is a failure the
// library shows with Retry, never an empty list of panels or actions.
import { describe, test, expect } from "bun:test";
import type { ActionInfo, PanelItem } from "@mileniumhq/paperapi";
import { loadLibraryLists } from "../src/lib/libraryLoad";

const panels = [{ id: "dev.paperboard.ai", name: "AI" }] as PanelItem[];
const actions = [{ panelId: "dev.paperboard.ai", action: "ask" }] as ActionInfo[];

describe("loadLibraryLists", () => {
    test("returns both lists when both reads succeed", async () => {
        expect(await loadLibraryLists({ panels: async () => panels, actions: async () => actions })).toEqual({
            kind: "ready",
            panels,
            actions,
        });
    });

    test("an unreachable action registry is a failure, not an empty library", async () => {
        const result = await loadLibraryLists({
            panels: async () => panels,
            actions: async () => {
                throw new Error("daemon unreachable");
            },
        });
        expect(result).toEqual({ kind: "failed", message: "daemon unreachable" });
    });

    test("so is a failed panel list", async () => {
        const result = await loadLibraryLists({ panels: () => Promise.reject(new Error("no panels")), actions: async () => actions });
        expect(result).toEqual({ kind: "failed", message: "no panels" });
    });
});
