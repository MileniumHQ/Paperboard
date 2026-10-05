import { describe, expect, test } from "bun:test";
import { DOCS_ALIASES, docsRoutes } from "../src/site/docsRoutes";
import { sectionKeys } from "../src/docs/structure";

describe("docs route registry", () => {
    test("every route is a docs directory path under /docs", () => {
        for (const route of docsRoutes()) {
            expect(route.path.startsWith("/docs/")).toBe(true);
            expect(route.path.endsWith("/")).toBe(true);
        }
    });

    test("includes the docs landing and a section root", () => {
        const paths = docsRoutes().map((route) => route.path);
        expect(paths).toContain("/docs/");
        expect(paths).toContain("/docs/paperapi/");
        expect(paths).toContain("/docs/paperui/");
    });

    test("includes every page in the index", () => {
        const paths = docsRoutes().map((route) => route.path);
        expect(paths).toContain("/docs/paperapi/overview/");
        expect(paths).toContain("/docs/paperapi/secrets/");
        expect(paths).toContain("/docs/paperui/paperbutton/");
    });

    test("gives every section a root and no duplicate paths", () => {
        const paths = docsRoutes().map((route) => route.path);
        for (const section of sectionKeys) {
            expect(paths).toContain(`/docs/${section}/`);
        }
        expect(new Set(paths).size).toBe(paths.length);
    });

    test("every title is non-empty", () => {
        for (const route of docsRoutes()) {
            expect(route.title.length).toBeGreaterThan(0);
            expect(route.description.length).toBeGreaterThan(0);
        }
    });

    test("aliases point at real docs section routes", () => {
        const paths = docsRoutes().map((route) => route.path);
        for (const alias of DOCS_ALIASES) {
            expect(paths).toContain(alias.target);
        }
    });
});
