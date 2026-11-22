import { describe, expect, test } from "vitest";
import { parseDelimited, sniffDelimiter } from "../templates/PaperPreview/viewers/TableView";
import { previewKind } from "../templates/PaperPreview/kinds";

// Inventory: Templates — PaperPreview reads a CSV the way a spreadsheet does.
describe("parseDelimited", () => {
    test("quoted cells keep their delimiters, line breaks and doubled quotes", () => {
        const { rows, more } = parseDelimited('a,b\r\n"x, y","line\nbreak"\n"say ""hi""",z', ",", 10);
        expect(rows).toEqual([
            ["a", "b"],
            ["x, y", "line\nbreak"],
            ['say "hi"', "z"],
        ]);
        expect(more).toBe(0);
    });

    test("a byte-order mark and a final newline add nothing", () => {
        expect(parseDelimited("﻿name\nAda\n", ",", 10).rows).toEqual([["name"], ["Ada"]]);
    });

    test("rows past the limit are counted, not kept, even with quoted line breaks", () => {
        const { rows, more } = parseDelimited('h\n1\n"2\n2"\n3\n4', ",", 2);
        expect(rows).toEqual([["h"], ["1"]]);
        expect(more).toBe(3);
    });

    test("a quote inside a cell past the limit doesn't swallow the rows after it", () => {
        const { more } = parseDelimited('h\n1\nab"c\nd\ne', ",", 2);
        expect(more).toBe(3);
    });
});

describe("sniffDelimiter", () => {
    test("a TSV by name or type, a semicolon CSV by its first line", () => {
        expect(sniffDelimiter("a\tb", "data.tsv")).toBe("\t");
        expect(sniffDelimiter("a,b", "data", "text/tab-separated-values")).toBe("\t");
        expect(sniffDelimiter("price;amount\n1,5;2", "prices.csv")).toBe(";");
        expect(sniffDelimiter("a,b;c,d", "x.csv")).toBe(",");
    });
});

describe("previewKind", () => {
    test("a media type is trusted before the name, and a generic one defers to it", () => {
        expect(previewKind("scan", "application/pdf")).toBe("pdf");
        expect(previewKind("ship.glb", "application/octet-stream")).toBe("model");
        expect(previewKind("notes.md", "text/plain")).toBe("markdown");
        expect(previewKind("photo.heic", "image/heic")).toBe(null);
        expect(previewKind("Dockerfile")).toBe("code");
        expect(previewKind("archive.zip")).toBe(null);
    });
});
