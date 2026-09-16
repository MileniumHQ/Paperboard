import { describe, expect, it } from "bun:test";
import {
    base64Decode,
    base64Encode,
    getField,
    isTruthyFlowValue,
    listLength,
    measureDuration,
    padText,
    parseJson,
    pickFromList,
    regexExtract,
    regexMatch,
    splitText,
    stringifyJson,
    toNumber,
    truncateText,
} from "../src/lib/builtinData";

describe("text helpers", () => {
    it("splits on a separator, and into characters when empty", () => {
        expect(splitText("a,b,c", ",")).toEqual(["a", "b", "c"]);
        expect(splitText("ab", "")).toEqual(["a", "b"]);
    });

    it("matches and extracts with capture groups", () => {
        expect(regexMatch("player_12 joined", "^player_\\d+")).toBe(true);
        expect(regexMatch("nope", "^player_\\d+")).toBe(false);
        expect(regexExtract("player_12 joined", "player_(\\d+)", 1)).toBe("12");
        expect(regexExtract("nope", "player_(\\d+)", 1)).toBeNull();
        expect(() => regexExtract("player_12", "player_(\\d+)", 4)).toThrow(/group/);
        expect(() => regexMatch("x", "([")).toThrow(/Invalid regular expression/);
    });

    it("truncates with an ending and pads on either side", () => {
        expect(truncateText("hello world", 8, "…")).toBe("hello w…");
        expect(truncateText("short", 8, "…")).toBe("short");
        expect(padText("7", 3, "start", "0")).toBe("007");
        expect(padText("7", 3, "end", "0")).toBe("700");
    });

    it("reads the first number, or refuses loudly", () => {
        expect(toNumber("12px")).toBe(12);
        expect(toNumber("-3.5 kg")).toBe(-3.5);
        expect(() => toNumber("abc")).toThrow(/does not contain a number/);
    });

    it("round-trips base64 including unicode", () => {
        const text = "héllo 🌍 wörld";
        expect(base64Decode(base64Encode(text))).toBe(text);
        expect(() => base64Decode("!!!")).toThrow(/base64/);
    });
});

describe("json and list helpers", () => {
    it("parses and stringifies with honest errors", () => {
        expect(parseJson('{"a":[1,2]}')).toEqual({ a: [1, 2] });
        expect(stringifyJson({ a: 1 }, false)).toBe('{"a":1}');
        expect(() => parseJson("{nope")).toThrow(/Invalid JSON/);
    });

    it("reads dotted paths through objects and lists", () => {
        const value = { a: { b: [{ c: 42 }] }, "": 1 };
        expect(getField(value, "a.b.0.c")).toBe(42);
        expect(getField(value, "a.missing")).toBeNull();
        expect(getField(value, "a.b.9.c")).toBeNull();
        expect(() => getField(value, "__proto__.x")).toThrow(/Invalid field path/);
    });

    it("counts and picks, with negative indexes from the end", () => {
        expect(listLength([1, 2, 3])).toBe(3);
        expect(listLength("abcd")).toBe(4);
        expect(listLength({ a: 1, b: 2 })).toBe(2);
        expect(pickFromList(["a", "b", "c"], -1)).toBe("c");
        expect(() => pickFromList(["a"], 5)).toThrow(/outside the list/);
        expect(() => pickFromList("nope", 0)).toThrow(/needs a list/);
    });
});

describe("timing helpers", () => {
    it("treats stringly false values as false", () => {
        expect(isTruthyFlowValue(true)).toBe(true);
        expect(isTruthyFlowValue("true")).toBe(true);
        expect(isTruthyFlowValue("yes")).toBe(true);
        expect(isTruthyFlowValue("false")).toBe(false);
        expect(isTruthyFlowValue("0")).toBe(false);
        expect(isTruthyFlowValue("")).toBe(false);
    });

    it("measures elapsed time from epoch or ISO input", () => {
        const now = Date.now();
        expect(measureDuration(now - 250)).toBeGreaterThanOrEqual(250);
        expect(measureDuration(new Date(now - 100).toISOString())).toBeGreaterThanOrEqual(50);
        expect(() => measureDuration("not a date")).toThrow(/timestamp/);
    });
});
