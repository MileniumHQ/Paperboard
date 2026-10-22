import { describe, expect, it } from "bun:test";
import {
    evaluateMathExpression as calculate,
    MAX_MATH_DEPTH,
    MAX_MATH_EXPRESSION_LENGTH,
    MAX_MATH_TOKENS,
} from "../src/lib/mathExpression";

describe("arithmetic expressions", () => {
    it.each([
        ["42", 42], [".5 + 2. + 1.25", 3.75], ["2e3 + 5E-1 + 1e+1", 2010.5],
        [" \t(2 + 3)\n * 4 ", 20], ["2 + 3 * 4^2", 50],
        ["2^3^2", 512], ["(2^3)^2", 64],
        ["20 - 5 - 3", 12], ["24 / 4 / 2", 3],
        ["20 / 2 * 3 % 7", 2], ["-7 % 4", -3],
        ["-2^2", -4], ["(-2)^2", 4], ["2^-2", 0.25],
        ["2^-2^2", 0.0625], ["--2 + +-3 - -4", 3],
        ["-0", -0], ["0^0", 1], ["1e-999", 0],
        // As before, the final result must be finite, not every intermediate.
        ["(1 / 0)^0", 1],
    ] as const)("evaluates %s", (expression, expected) => {
        expect(calculate(expression)).toBe(expected);
    });

    it.each(["1 / 0", "0 / 0", "1 % 0", "(-1)^.5", "1e309", "1e308 * 2", "2^1024"])(
        "rejects non-finite result: %s", (expression) => {
            expect(() => calculate(expression)).toThrow(/finite number/);
        },
    );

    it.each([
        "", "   ", "2 +", "()", "(1 + 2", "1 + 2)", "1 2", "2(3)",
        ".", "1..2", "1e", "1e+", "1e2.3", "0x10", "0b10", "2**3",
        "a", "PI", "E", "Infinity", "NaN", "true", "a.b", "(1).value",
        "constructor", "__proto__", "constructor(1)", "unknown(2)", "abs(-2)",
        "[1]", "1[0]", "'2'", '"2"', "`2`", "a=2", "1=2", "1;2",
        "1,2", "1<2", "1==1", "1?2:3", "1&&2", "1||2", "1!", "/*x*/1",
    ])("rejects syntax outside arithmetic: %s", (expression) => {
        expect(() => calculate(expression)).toThrow();
    });

    it("bounds raw input length including whitespace", () => {
        expect(calculate("1".padEnd(MAX_MATH_EXPRESSION_LENGTH))).toBe(1);
        expect(() => calculate("1".padEnd(MAX_MATH_EXPRESSION_LENGTH + 1))).toThrow(
            /length exceeds 4096 characters/,
        );
    });

    it("bounds token count separately from input length", () => {
        const expression = "+" + "1+".repeat((MAX_MATH_TOKENS - 2) / 2) + "1";
        expect(calculate(expression)).toBe(MAX_MATH_TOKENS / 2);
        expect(() => calculate(expression + "+1")).toThrow(/token count exceeds 1024/);
    });

    it.each([
        (depth: number) => "(".repeat(depth) + "1" + ")".repeat(depth),
        (depth: number) => "+".repeat(depth) + "1",
        (depth: number) => "1^".repeat(depth) + "1",
        (depth: number) => "(".repeat(32) + "+".repeat(depth - 32) + "1" + ")".repeat(32),
    ])("bounds parentheses, signs, powers and their combined nesting", (expression) => {
        expect(calculate(expression(MAX_MATH_DEPTH))).toBe(1);
        expect(() => calculate(expression(MAX_MATH_DEPTH + 1))).toThrow(/nesting depth exceeds 64/);
    });
});
