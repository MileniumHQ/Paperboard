import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { landingChrome } from "../src/site/chrome";
import {
    BRAND,
    DOCS_LINKS,
    LEARN_LINKS,
    SITE_LINKS,
} from "../src/site/links";

const landing = readFileSync(
    join(import.meta.dir, "../public/index.html"),
    "utf8",
);

const REGIONS = [
    "learn",
    "docs",
    "footer-learn",
    "footer-docs",
    "footer-site",
];

describe("site nav contents", () => {
    test("the landing keeps a marker pair for every generated region", () => {
        for (const name of REGIONS) {
            expect(landing).toContain(`<!-- site-nav:${name} -->`);
            expect(landing).toContain(`<!-- /site-nav:${name} -->`);
        }
    });

    test("the generated topbar chrome carries every learn link", () => {
        for (const link of LEARN_LINKS) {
            expect(landingChrome.topbarLearn).toContain(
                `href="${link.href}"`,
            );
            expect(landingChrome.topbarLearn).toContain(link.label);
        }
    });

    test("the generated docs chrome mirrors the docs sections", () => {
        expect(DOCS_LINKS.length).toBeGreaterThan(0);
        for (const link of DOCS_LINKS) {
            expect(link.href).toMatch(/^\/docs\/[a-z0-9-]+$/);
            expect(landingChrome.topbarDocs).toContain(
                `href="${link.href}"`,
            );
            expect(landingChrome.footerDocs).toContain(
                `href="${link.href}"`,
            );
        }
    });

    test("the footer columns carry the shared link lists", () => {
        for (const link of SITE_LINKS) {
            expect(landingChrome.footerSite).toContain(
                `href="${link.href}"`,
            );
        }
        expect(landingChrome.footerLearn).toContain('href="/"');
        for (const link of LEARN_LINKS) {
            expect(landingChrome.footerLearn).toContain(
                `href="${link.href}"`,
            );
        }
    });

    test("generated chrome escapes labels and attributes", () => {
        expect(landingChrome.topbarLearn).toContain("Game Server");
        expect(landingChrome.topbarLearn).not.toContain("&amp;amp;");
        expect(landingChrome.topbarLearn).toContain(
            "Dedicated Minecraft &amp; game server manager",
        );
    });

    test("the landing brand is Paperboard, not PaperDocs", () => {
        expect(BRAND.name).toBe("Paperboard");
        expect(landing).toContain("site-topbar__name\">Paperboard");
    });

    test("every landing download action points at /downloads", () => {
        const matches = landing.match(/href="\/downloads"/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    test("the docs and site builds share one theme implementation", () => {
        const theme = readFileSync(
            join(import.meta.dir, "../src/utils/theme.ts"),
            "utf8",
        );
        expect(theme).toContain('THEME_KEY = "paper-docs-theme"');

        const app = readFileSync(
            join(import.meta.dir, "../src/App.tsx"),
            "utf8",
        );
        const siteTopbar = readFileSync(
            join(import.meta.dir, "../src/site/SiteTopbar.tsx"),
            "utf8",
        );
        expect(app).toContain("createPaperTheme");
        expect(siteTopbar).toContain("createPaperTheme");
    });
});
