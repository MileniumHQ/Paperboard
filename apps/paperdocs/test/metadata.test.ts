import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { siteMetadata } from "../scripts/site-metadata.mjs";

const HOSTILE_TITLE = `Servers </script><script>alert("t")</script> & "quotes" <b>`;
const HOSTILE_DESCRIPTION = `"><img src=x onerror=alert(1)> & </script><!--`;

// Page metadata is escaped.
describe("page metadata is escaped", () => {
    const head = siteMetadata({ title: HOSTILE_TITLE, description: HOSTILE_DESCRIPTION }, "/blog/hostile/");
    const doc = parse(`<head>${head}</head>`);

    test("titles and descriptions come back exactly from every tag, with no injected elements", () => {
        expect(doc.querySelector("title")?.text).toBe(HOSTILE_TITLE);
        for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
            expect({ selector, content: doc.querySelector(selector)?.getAttribute("content") }).toEqual({ selector, content: HOSTILE_DESCRIPTION });
        }
        for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
            expect({ selector, content: doc.querySelector(selector)?.getAttribute("content") }).toEqual({ selector, content: HOSTILE_TITLE });
        }
        expect(doc.querySelectorAll("img")).toHaveLength(0);
        expect(doc.querySelectorAll("b")).toHaveLength(0);
    });

    test("a title containing </script> stays inside the JSON-LD block", () => {
        const scripts = doc.querySelectorAll("script");
        expect(scripts).toHaveLength(1);
        expect(scripts[0]!.getAttribute("type")).toBe("application/ld+json");
        // the only way out of a script element is "</script", which the block never contains
        expect(head.match(/<\/script/gi)).toHaveLength(1);
        const schema = JSON.parse(scripts[0]!.rawText) as { "@graph": { name: string; description?: string }[] };
        const page = schema["@graph"][1]!;
        expect(page.name).toBe(HOSTILE_TITLE);
        expect(page.description).toBe(HOSTILE_DESCRIPTION);
    });
});
