// Screenshot viewport/scale/shortcut contract (bun test): the pure validation
// the controller and its preload rely on. The window-opening capture boundary
// is exercised by hand; these assertions need no Electron window. Electron is
// stubbed because the module imports it for installScreenshotTool.
import { describe, it, expect, mock, beforeAll } from "bun:test";
import { electronStub } from "./electronStub";

mock.module("electron", () => electronStub());

type Tool = typeof import("../src/main/screenshotTool");
let tool: Tool;

beforeAll(async () => {
    tool = await import("../src/main/screenshotTool");
});

const key = (overrides: Record<string, unknown> = {}) => ({
    type: "keyDown" as const,
    key: "F8",
    shift: true,
    control: true,
    meta: false,
    alt: false,
    isAutoRepeat: false,
    ...overrides,
});

describe("screenshotSize", () => {
    it("accepts whole pixels within 320-3840 x 240-2160", () => {
        expect(tool.screenshotSize(1440, 900)).toEqual({ width: 1440, height: 900 });
        expect(tool.screenshotSize(320, 240)).toEqual({ width: 320, height: 240 });
        expect(tool.screenshotSize(3840, 2160)).toEqual({ width: 3840, height: 2160 });
    });

    it("rejects non-integers, out-of-range sizes, and non-numbers", () => {
        expect(() => tool.screenshotSize(1439.5, 900)).toThrow();
        expect(() => tool.screenshotSize(319, 900)).toThrow();
        expect(() => tool.screenshotSize(100000, 900)).toThrow();
        expect(() => tool.screenshotSize(1440, 5000)).toThrow();
        expect(() => tool.screenshotSize("1440", 900)).toThrow();
    });
});

describe("screenshotOutputSize", () => {
    it("scales the viewport", () => {
        expect(tool.screenshotOutputSize(1440, 900, 2)).toEqual({ width: 2880, height: 1800 });
        expect(tool.screenshotOutputSize(1440, 900, 0.25)).toEqual({ width: 360, height: 225 });
    });

    it("rejects scales outside 0.25x-4x and outputs above 32 million pixels", () => {
        expect(() => tool.screenshotOutputSize(1440, 900, 0)).toThrow();
        expect(() => tool.screenshotOutputSize(1440, 900, 5)).toThrow();
        expect(() => tool.screenshotOutputSize(1440, 900, Number.NaN)).toThrow();
        expect(() => tool.screenshotOutputSize(3840, 2160, 4)).toThrow(/32 million/);
    });
});

describe("isScreenshotShortcut", () => {
    it("is F8+shift with control on linux/windows and meta on darwin", () => {
        expect(tool.isScreenshotShortcut(key(), "linux")).toBe(true);
        expect(tool.isScreenshotShortcut(key({ control: false, meta: true }), "darwin")).toBe(true);
        expect(tool.isScreenshotShortcut(key(), "darwin")).toBe(false);
        expect(tool.isScreenshotShortcut(key({ control: false, meta: true }), "linux")).toBe(false);
    });

    it("ignores auto-repeat, alt, and non-keydown events", () => {
        expect(tool.isScreenshotShortcut(key({ isAutoRepeat: true }), "linux")).toBe(false);
        expect(tool.isScreenshotShortcut(key({ alt: true }), "linux")).toBe(false);
        expect(tool.isScreenshotShortcut(key({ type: "keyUp" }), "linux")).toBe(false);
        expect(tool.isScreenshotShortcut(key({ key: "F9" }), "linux")).toBe(false);
    });
});
