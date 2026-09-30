import { describe, expect, test } from "bun:test";
import { tocLevel } from "../src/utils/toc";

const el = (tagName: string, attrs: Record<string, string> = {}) => ({
    tagName,
    getAttribute: (name: string) => attrs[name] ?? null,
});

describe("tocLevel", () => {
    test("maps PaperText heading presets and heading tags to depths", () => {
        expect(tocLevel(el("DIV", { "data-preset": "subheader" }))).toBe(0);
        expect(tocLevel(el("DIV", { "data-preset": "title" }))).toBe(1);
        expect(tocLevel(el("DIV", { "data-preset": "subtitle" }))).toBe(2);
        expect(tocLevel(el("h3"))).toBe(1);
    });

    test("skips ids on non-headings, including SVG elements in live demos", () => {
        // an SVG clipPath's className is an SVGAnimatedString, which the old
        // className.toLowerCase() check threw on, stopping every later effect
        expect(tocLevel(el("clipPath", { id: "paper-audio-wave-cl-2" }))).toBeNull();
        expect(tocLevel(el("DIV", { "data-preset": "body" }))).toBeNull();
        expect(tocLevel(el("SPAN"))).toBeNull();
    });
});
