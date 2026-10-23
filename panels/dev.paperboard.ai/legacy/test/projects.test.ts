// A project's name is its folder's name, so it must be one safe segment everywhere.
import { describe, expect, it } from "bun:test";
import { MAX_PROJECT_NAME_CHARS, projectName } from "../src/core/projects";

describe("project names", () => {
    it("trims and keeps ordinary names, in any script", () => {
        expect(projectName("  my-app ")).toBe("my-app");
        expect(projectName("Tableau v2.1")).toBe("Tableau v2.1");
        expect(projectName("プロジェクト")).toBe("プロジェクト");
    });

    it("refuses anything that isn't one plain folder name", () => {
        for (const bad of ["", " ", "a/b", "a\\b", "..", ".hidden", "trailing.", "con", "LPT1.txt", "x".repeat(MAX_PROJECT_NAME_CHARS + 1), "tab\tname"]) {
            expect(() => projectName(bad)).toThrow();
        }
    });
});
