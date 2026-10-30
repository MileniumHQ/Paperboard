import { describe, expect, it } from "bun:test";
import {
    MAX_ATTACHMENT_TEXT_BYTES,
    capText,
    convertToText,
    extensionOf,
    imageBase64,
    isImageMime,
    isSupportedTextFile,
    stripHtml,
    validateAttachments,
} from "../src/core/attachments";
import type { Attachment } from "../src/core/types";

const image = (patch: Partial<Attachment> = {}): Attachment => ({
    id: "i",
    name: "shot.png",
    kind: "image",
    mime: "image/png",
    sizeBytes: 1000,
    dataUrl: "data:image/png;base64,AAAA",
    ...patch,
});

const text = (patch: Partial<Attachment> = {}): Attachment => ({
    id: "f",
    name: "notes.md",
    kind: "text",
    mime: "text/markdown",
    sizeBytes: 100,
    text: "# Notes",
    ...patch,
});

describe("attachment types", () => {
    it("recognizes image mimes and text extensions", () => {
        expect(isImageMime("image/jpeg")).toBe(true);
        expect(isImageMime("application/pdf")).toBe(false);
        expect(isSupportedTextFile("notes.md", "")).toBe(true);
        expect(isSupportedTextFile("data.json", "application/json")).toBe(true);
        expect(isSupportedTextFile("server.log", "text/plain")).toBe(true);
        expect(isSupportedTextFile("report.pdf", "application/pdf")).toBe(false);
        expect(isSupportedTextFile("archive.zip", "application/zip")).toBe(false);
    });

    it("extracts base64 payloads only from image data URLs", () => {
        expect(imageBase64("data:image/png;base64,AAAA")).toBe("AAAA");
        expect(imageBase64("data:text/plain;base64,AAAA")).toBeNull();
        expect(imageBase64("not-a-data-url")).toBeNull();
    });

    it("extensionOf handles paths and Dockerfile", () => {
        expect(extensionOf("/a/b/c.TS")).toBe("ts");
        expect(extensionOf("Dockerfile")).toBe("dockerfile");
        expect(extensionOf("noext")).toBe("");
    });
});

describe("conversion", () => {
    it("strips HTML to readable text", () => {
        const out = stripHtml("<h1>Title</h1><p>Hello <b>world</b>&amp; friends</p><script>alert(1)</script>");
        expect(out).toContain("Title");
        expect(out).toContain("Hello world & friends");
        expect(out).not.toContain("alert");
        expect(out).not.toContain("<");
    });

    it("converts an html file and caps long text", () => {
        expect(convertToText("page.html", "<p>hi</p>")).toBe("hi");
        const big = capText("a".repeat(MAX_ATTACHMENT_TEXT_BYTES + 100), MAX_ATTACHMENT_TEXT_BYTES);
        expect(big.endsWith("[truncated]")).toBe(true);
        expect(new TextEncoder().encode(big).length).toBeLessThanOrEqual(MAX_ATTACHMENT_TEXT_BYTES + 20);
    });

    it("normalizes CRLF", () => {
        expect(convertToText("a.txt", "x\r\ny")).toBe("x\ny");
    });
});

describe("validateAttachments", () => {
    it("passes text files and images when the model can see", () => {
        expect(() => validateAttachments([text(), image()], { vision: true })).not.toThrow();
    });

    it("refuses an image for a model without vision", () => {
        expect(() => validateAttachments([image()], { vision: false })).toThrow(/cannot see images/);
    });

    it("refuses empty text, undecodable images, and too many files", () => {
        expect(() => validateAttachments([text({ text: "  " })], { vision: true })).toThrow(/no readable text/);
        expect(() => validateAttachments([image({ dataUrl: "nope" })], { vision: true })).toThrow(/not a readable image/);
        const many = Array.from({ length: 7 }, (_, i) => text({ id: `f${i}` }));
        expect(() => validateAttachments(many, { vision: true })).toThrow(/At most/);
    });
});
