// Dangling variable references (bun test): when a chip's source block is
// moved away or deleted, the run must fail with a sentence naming the
// variable instead of forwarding `{{id:Label:icon}}` to an API that answers
// with a raw validation error.
import { describe, test, expect } from "bun:test";
import {
    findUnresolvedReferences,
    resolveInputs,
} from "../src/lib/runtime";

describe("findUnresolvedReferences", () => {
    test("extracts every remaining chip in a string", () => {
        const refs = findUnresolvedReferences(
            "hello {{values.name:Name:person}} and {{other:Other:bolt}}",
        );
        expect(refs).toEqual([
            { token: "values.name", label: "Name" },
            { token: "other", label: "Other" },
        ]);
    });

    test("plain text and values have no references", () => {
        expect(findUnresolvedReferences("hello")).toEqual([]);
        expect(findUnresolvedReferences("")).toEqual([]);
    });
});

describe("resolveInputs with dangling references", () => {
    test("throws a readable error naming the variable and its input", () => {
        expect(() =>
            resolveInputs(
                { channel: { type: "string", label: "Channel" } },
                { channel: "{{values.channel:Channel:tag}}" },
                {},
                {},
            ),
        ).toThrow(/Variable "Channel" for "Channel" has no source/);
    });

    test("resolves a parameter field from the trigger payload", () => {
        const resolved = resolveInputs(
            { channel: { type: "string", label: "Channel" } },
            { channel: "{{values.channel:Channel:tag}}" },
            {},
            { values: { channel: "123456789" } },
        );
        expect(resolved.channel).toBe("123456789");
    });

    test("still forwards literal text and present variables together", () => {
        const resolved = resolveInputs(
            { content: { type: "string", label: "Content" } },
            { content: "hello {{values.name:Name:person}}!" },
            {},
            { values: { name: "alice" } },
        );
        expect(resolved.content).toBe("hello alice!");
    });
});
