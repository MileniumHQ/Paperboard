import { describe, it, expect } from "bun:test";
import { buildGreeting } from "../src/lib/greet";

describe("buildGreeting", () => {
    it("greets a trimmed name", () => {
        expect(buildGreeting("  Ada  ")).toBe("Hello, Ada!");
    });

    it("refuses an empty name instead of greeting nobody", () => {
        expect(() => buildGreeting("   ")).toThrow(/required/);
    });

    it("refuses names longer than the boundary", () => {
        expect(() => buildGreeting("x".repeat(65))).toThrow(/64/);
        expect(buildGreeting("x".repeat(64))).toBe(`Hello, ${"x".repeat(64)}!`);
    });
});
