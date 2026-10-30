// The Library over panels with projects (bun test): a panel's global blocks
// always show, one project's at a time beside them, hidden blocks never,
// and a search names the project each match comes from.
import { describe, expect, test } from "bun:test";
import type { ActionInfo, ProjectInfo } from "@mileniumhq/paperapi";
import { categorySections, panelCategoriesFrom, searchLibrary, shownProject } from "../src/lib/libraryCategories";

const PANEL = "dev.example.servers";
const action = (id: string, extra: Partial<ActionInfo> = {}, schema: Record<string, unknown> = {}): ActionInfo => ({
    panelId: PANEL,
    action: id,
    schema: { id, name: id, description: "", ...schema },
    ...extra,
}) as ActionInfo;

const projects: ProjectInfo[] = [
    { panelId: PANEL, id: "survival", name: "Survival" },
    { panelId: PANEL, id: "creative", name: "Creative" },
];
const registered = [
    action("create-server"),
    action("survival/send", { project: "survival" }),
    action("survival/on-join", { project: "survival" }, { eventOnly: true }),
    action("creative/send", { project: "creative" }),
    action("not-yet/send", { project: "not-yet" }),
    action("for-programs", {}, { hidden: true }),
    action("survival/wipe", { project: "survival" }, { hidden: true }),
];
const info = () => ({ name: "Servers", iconUrl: "icon.png" });
const ids = (sections: ReturnType<typeof categorySections>) =>
    sections.flatMap((s) => [...s.triggers, ...s.actions]).map((a) => a.action).sort();

describe("the Library's projects", () => {
    const [category] = panelCategoriesFrom(registered, info, projects);

    test("a panel lists its projects by name and never offers hidden blocks", () => {
        expect(category.projects.map((p) => p.name)).toEqual(["Creative", "Survival"]);
        const offered = [...category.triggers, ...category.actions].map((a) => a.action);
        expect(offered).not.toContain("for-programs");
        expect(offered).not.toContain("survival/wipe");
        // a project not announced yet waits for the registry update
        expect(offered).not.toContain("not-yet/send");
    });

    test("the global blocks and the shown project's, never another project's", () => {
        expect(ids(categorySections(category, "survival"))).toEqual(["create-server", "survival/on-join", "survival/send"]);
        expect(ids(categorySections(category, "creative"))).toEqual(["create-server", "creative/send"]);
    });

    test("the chosen project shows while it exists, else the first", () => {
        expect(shownProject(category, "survival")?.id).toBe("survival");
        expect(shownProject(category, "removed")?.id).toBe("creative");
        expect(shownProject(category, undefined)?.id).toBe("creative");
    });

    test("a panel without projects shows every block and no project", () => {
        const [plain] = panelCategoriesFrom([action("create-server")], info, []);
        expect(shownProject(plain, undefined)).toBeNull();
        expect(ids(categorySections(plain, null))).toEqual(["create-server"]);
    });

    test("a search groups matches under the panel, then each project by name", () => {
        const groups = searchLibrary([category], "send");
        expect(groups.map((g) => [g.categoryName, g.items.map((i) => i.data.action)])).toEqual([
            ["Servers · Creative", ["creative/send"]],
            ["Servers · Survival", ["survival/send"]],
        ]);
        expect(searchLibrary([category], "create")[0].categoryName).toBe("Servers");
    });
});
