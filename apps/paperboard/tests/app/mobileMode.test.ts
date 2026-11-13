import { describe, expect, test } from "bun:test";
import { injectCspNonce, injectMobileMode } from "../../src/shared/panelDocument";

describe("a panel document's mobile mode", () => {
    test("is stamped first in the head, before the panel's own scripts, for either value", () => {
        for (const mobile of [true, false]) {
            const html = injectMobileMode("<html><head><script src=\"a.js\"></script></head></html>", mobile);
            expect(html.indexOf(`"data-paper-mobile","${mobile}"`)).toBeGreaterThan(-1);
            expect(html.indexOf("data-paper-mobile")).toBeLessThan(html.indexOf("a.js"));
        }
    });

    test("a document with no head is stamped too, and its script takes the CSP nonce", () => {
        const html = injectCspNonce(injectMobileMode("<p>hi</p>", true), "n0nce");
        expect(html.startsWith('<script nonce="n0nce">')).toBe(true);
        expect(html).toContain('"data-paper-mobile","true"');
    });
});
