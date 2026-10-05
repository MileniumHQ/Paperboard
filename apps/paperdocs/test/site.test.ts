import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    docsDropdownHtml,
    footerDocsHtml,
    footerLearnHtml,
    footerSiteHtml,
    learnDropdownHtml,
    mobileMenuHtml,
} from "../src/site/landing/chromeHtml";
import {
    BRAND,
    DOCS_LINKS,
    LEARN_LINKS,
    SITE_LINKS,
} from "../src/site/links";

// The landing's link contents come from src/site/chromeHtml.ts, which reads
// the shared nav source (src/site/links.ts). The Solid page hands these
// fragments to its custom-element host wrappers as innerHTML, so the same
// escaping and href shapes the old injected chrome had must survive.

describe("landing chrome contents", () => {
    test("the generated topbar chrome carries every learn link", () => {
        for (const link of LEARN_LINKS) {
            expect(learnDropdownHtml).toContain(`href="${link.href}"`);
            expect(learnDropdownHtml).toContain(link.label);
        }
    });

    test("the generated docs chrome mirrors the docs sections", () => {
        expect(DOCS_LINKS.length).toBeGreaterThan(0);
        for (const link of DOCS_LINKS) {
            expect(link.href).toMatch(/^\/docs\/[a-z0-9-]+\/$/);
            expect(docsDropdownHtml).toContain(`href="${link.href}"`);
            expect(footerDocsHtml).toContain(`href="${link.href}"`);
        }
    });

    test("the footer columns carry the shared link lists", () => {
        for (const link of SITE_LINKS) {
            expect(footerSiteHtml).toContain(`href="${link.href}"`);
        }
        expect(footerLearnHtml).toContain('href="/"');
        for (const link of LEARN_LINKS) {
            expect(footerLearnHtml).toContain(`href="${link.href}"`);
        }
    });

    test("the mobile panel carries every section", () => {
        for (const link of LEARN_LINKS) {
            expect(mobileMenuHtml).toContain(`href="${link.href}"`);
        }
        for (const link of DOCS_LINKS) {
            expect(mobileMenuHtml).toContain(`href="${link.href}"`);
        }
        for (const link of SITE_LINKS) {
            expect(mobileMenuHtml).toContain(`href="${link.href}"`);
        }
    });

    test("generated chrome escapes labels and attributes", () => {
        expect(learnDropdownHtml).toContain("Game Server");
        expect(learnDropdownHtml).not.toContain("&amp;amp;");
        expect(learnDropdownHtml).toContain(
            "Dedicated Minecraft &amp; game server manager",
        );
    });

    test("the landing brand is Paperboard, not PaperDocs", () => {
        expect(BRAND.name).toBe("Paperboard");
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
