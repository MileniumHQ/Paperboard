// The block library's read (bun test): a failed read is a failure the
// library shows with Retry, never an empty list of panels or actions.
import { describe, test, expect } from "bun:test";
import type { ActionInfo, PanelItem, ProjectInfo } from "@mileniumhq/paperapi";
import { loadLibraryLists } from "../src/lib/libraryLoad";

const panels = [{ id: "dev.paperboard.agents", name: "AI" }] as PanelItem[];
const actions = [{ panelId: "dev.paperboard.agents", action: "ask" }] as ActionInfo[];
const projects: ProjectInfo[] = [{ panelId: "dev.paperboard.gameserver", id: "survival", name: "Survival" }];

describe("loadLibraryLists", () => {
    test("returns every list when every read succeeds", async () => {
        expect(await loadLibraryLists({ panels: async () => panels, actions: async () => actions, projects: async () => projects })).toEqual({
            kind: "ready",
            panels,
            actions,
            projects,
        });
    });

    test("an unreachable action registry is a failure, not an empty library", async () => {
        const result = await loadLibraryLists({
            panels: async () => panels,
            actions: async () => {
                throw new Error("daemon unreachable");
            },
            projects: async () => projects,
        });
        expect(result).toEqual({ kind: "failed", message: "daemon unreachable" });
    });

    test("so is a failed panel list", async () => {
        const result = await loadLibraryLists({ panels: () => Promise.reject(new Error("no panels")), actions: async () => actions, projects: async () => projects });
        expect(result).toEqual({ kind: "failed", message: "no panels" });
    });

    test("so is a failed project list", async () => {
        const result = await loadLibraryLists({ panels: async () => panels, actions: async () => actions, projects: () => Promise.reject(new Error("no projects")) });
        expect(result).toEqual({ kind: "failed", message: "no projects" });
    });
});
