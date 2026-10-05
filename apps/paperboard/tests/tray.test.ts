import { describe, expect, test } from "bun:test";
import { traySummary } from "../src/main/traySummary";

describe("tray summary", () => {
    test("unknown count is just the app name", () => {
        expect(traySummary(null)).toBe("Paperboard");
    });

    test("zero running services reads as none, not a zero count", () => {
        expect(traySummary(0)).toBe("Paperboard · no processes running");
    });

    test("pluralizes one process", () => {
        expect(traySummary(1)).toBe("Paperboard · running 1 process");
    });

    test("pluralizes many processes", () => {
        expect(traySummary(4)).toBe("Paperboard · running 4 processes");
    });
});
