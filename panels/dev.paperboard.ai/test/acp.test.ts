// What an agent sends, checked and cut at one boundary (core/acp.ts), and
// what a user's message becomes on the way to the agent.
import { describe, expect, it } from "bun:test";
import {
    applyToolUpdate,
    authMethodsFrom,
    commandsFrom,
    MAX_DIFF_CHARS,
    MAX_PLAN_ENTRIES,
    MAX_TOOL_OUTPUT_CHARS,
    permissionOptions,
    planFrom,
    promptBlocks,
    toolRecordFrom,
} from "../src/core/acp";
import type { Attachment } from "../src/core/types";

describe("agent tool calls", () => {
    it("records a tool call's kind, files, edit and command", () => {
        const record = toolRecordFrom({
            toolCallId: "t1",
            title: "Run tests",
            kind: "execute",
            status: "pending",
            rawInput: { command: ["bun", "test"] },
            locations: [{ path: "/w/a.ts", line: 3 }],
            content: [{ type: "diff", path: "/w/a.ts", oldText: null, newText: "x" }],
        });
        expect(record).toMatchObject({
            id: "t1",
            label: "Run tests",
            status: "running",
            agent: { kind: "execute", command: "bun test", locations: ["/w/a.ts:3"], diffs: [{ path: "/w/a.ts", oldText: null, newText: "x" }] },
        });
    });

    it("ignores a tool call without an id and reads an unknown kind as other", () => {
        expect(toolRecordFrom({ title: "x" })).toBeUndefined();
        expect(toolRecordFrom({ toolCallId: "t", kind: "teleport" })?.agent?.kind).toBe("other");
    });

    it("cuts output and edits to fit the chat", () => {
        const record = toolRecordFrom({
            toolCallId: "t",
            content: [
                { type: "content", content: { type: "text", text: "o".repeat(MAX_TOOL_OUTPUT_CHARS + 10) } },
                { type: "diff", path: "p", oldText: "a", newText: "n".repeat(MAX_DIFF_CHARS + 1) },
            ],
        })!;
        expect(record.agent!.output!.startsWith("o".repeat(MAX_TOOL_OUTPUT_CHARS))).toBe(true);
        expect(record.agent!.output!.endsWith("(cut to fit the chat)")).toBe(true);
        expect(record.agent!.diffs[0]).toMatchObject({ truncated: true });
        expect(record.agent!.diffs[0]!.newText).toHaveLength(MAX_DIFF_CHARS);
    });

    it("applies only what an update carries, and never un-denies a call", () => {
        const record = toolRecordFrom({ toolCallId: "t", title: "Read", kind: "read", locations: [{ path: "a" }] })!;
        applyToolUpdate(record, { status: "completed", content: [{ type: "content", content: { type: "text", text: "body" } }] });
        expect(record).toMatchObject({ label: "Read", status: "done", agent: { kind: "read", locations: ["a"], output: "body" } });
        record.status = "denied";
        applyToolUpdate(record, { status: "failed" });
        expect(record.status).toBe("denied");
    });
});

describe("agent requests and reports", () => {
    it("keeps only well-formed permission answers, and refuses a request with none", () => {
        expect(
            permissionOptions([
                { optionId: "a", name: "Allow", kind: "allow_once" },
                { optionId: "b", name: "Bad", kind: "maybe" },
                { name: "No id", kind: "reject_once" },
            ]),
        ).toEqual([{ id: "a", name: "Allow", kind: "allow_once" }]);
        expect(() => permissionOptions([])).toThrow("without any answers");
    });

    it("offers only sign-in methods the agent runs itself", () => {
        expect(
            authMethodsFrom([
                { id: "a", name: "Browser" },
                { id: "t", name: "Terminal", type: "terminal" },
            ]),
        ).toEqual([{ id: "a", name: "Browser" }]);
    });

    it("caps a plan and drops malformed commands", () => {
        const plan = planFrom({ entries: Array.from({ length: MAX_PLAN_ENTRIES + 5 }, (_, i) => ({ content: `step ${i}`, status: i ? "weird" : "completed" })) });
        expect(plan).toHaveLength(MAX_PLAN_ENTRIES);
        expect(plan.slice(0, 2)).toEqual([
            { content: "step 0", status: "completed" },
            { content: "step 1", status: "pending" },
        ]);
        expect(commandsFrom([{ name: "ok", description: "d", input: { hint: "file" } }, { name: "has space" }])).toEqual([{ name: "ok", description: "d", hint: "file" }]);
    });
});

describe("a message to an agent", () => {
    const file: Attachment = { id: "f", kind: "text", name: "notes.md", mime: "text/markdown", sizeBytes: 5, text: "hello" };
    const image: Attachment = { id: "i", kind: "image", name: "a.png", mime: "image/png", sizeBytes: 3, dataUrl: "data:image/png;base64,AAAA" };

    it("embeds files when the agent takes them, else inlines them", () => {
        expect(promptBlocks("fix it", [file], { image: false, embeddedContext: true }, "Fake")).toEqual([
            { type: "resource", resource: { uri: "attachment:///notes.md", mimeType: "text/markdown", text: "hello" } },
            { type: "text", text: "fix it" },
        ]);
        expect(promptBlocks("fix it", [file], { image: false, embeddedContext: false }, "Fake")[0]).toEqual({ type: "text", text: "Attached file notes.md:\n\nhello" });
    });

    it("sends images only to an agent that can see them", () => {
        expect(() => promptBlocks("", [image], { image: false, embeddedContext: true }, "Fake")).toThrow("Fake can't read images.");
        expect(promptBlocks("", [image], { image: true, embeddedContext: true }, "Fake")).toEqual([{ type: "image", mimeType: "image/png", data: "AAAA" }]);
    });
});
