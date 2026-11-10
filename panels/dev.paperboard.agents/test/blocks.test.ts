import { afterEach, describe, expect, test } from "bun:test";
import { TURN_PROC_ID } from "../src/service/conversation";
import { appRig, type AppRig } from "./support/app";
import { SLOW } from "./support/host";

let rig: AppRig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

const replies = (r: AppRig) => r.blocks.fired.items.filter((f) => f.event === "message-received");

// The agent's blocks (Actions API v2), as the Blocks panel runs them.
describe("the agent's blocks", () => {
    test("registers the Conversation type, the conversations as values, the flow commands and the reply event, and none of the panel's own actions", async () => {
        rig = await appRig();
        const set = rig.blocks.set!;
        expect(set.types!.map((t) => t.id)).toEqual(["conversation", "message", "attachment"]);
        expect(Object.keys(set.types![0]!.fields!)).toEqual(["title", "messages"]);
        expect(set.values!.map((v) => [v.id, v.type, v.changes])).toEqual([
            ["current-conversation", "conversation", true],
            ["conversations", "list<conversation>", true],
        ]);
        expect(set.commands!.map((c) => [c.id, c.output])).toEqual([
            ["switch-conversation", "conversation"],
            ["new-conversation", "conversation"],
            ["send-message", "message"],
            ["get-answer", "text"],
        ]);
        expect(set.events!.map((e) => [e.id, e.filters])).toEqual([["message-received", { conversation: "conversation" }]]);
        for (const def of [...set.commands!, ...set.values!, ...set.events!]) expect(def.category).toBe("Agent");
    });

    test("a text to the agent is a Message, its reply fires When the Agent Replies, and the conversations announce the change", async () => {
        rig = await appRig();
        const current = await rig.blocks.read<string>("current-conversation");
        expect(await rig.blocks.read("conversations")).toEqual([]);
        expect(await rig.blocks.property("conversation", "title", current)).toBe("New conversation");

        const message = await rig.blocks.run<string>("send-message", { message: "what's up?" });
        await rig.blocks.fired.until((f) => f.length > 0, "the agent's reply");
        const entry = rig.app.conversation.history().find((e) => e.kind === "agent")!;
        expect(replies(rig)[0]!.payload).toEqual({
            text: entry.kind === "agent" ? entry.text : "",
            attachments: [],
            message: entry.id,
            conversation: current,
            "reply-to": "",
        });
        expect(rig.app.conversation.history()[0]).toMatchObject({ id: message, kind: "user", text: "what's up?" });

        await rig.blocks.changes.until((c) => c.includes("conversations"), "the conversations to announce the change");
        expect(rig.blocks.changes.items).not.toContain("current-conversation");
        expect(await rig.blocks.read("conversations")).toEqual([current]);
        expect(await rig.blocks.property("conversation", "title", current)).toBe("what's up?");
        expect(await rig.blocks.property("conversation", "messages", current)).toBe(2);
    }, SLOW);

    test("New Conversation and Switch Conversation give back the Conversation, and an unknown one is refused", async () => {
        rig = await appRig();
        await rig.blocks.run("send-message", { message: "first" });
        await rig.blocks.fired.until((f) => f.length === 1, "the first reply");
        const first = await rig.blocks.read<string>("current-conversation");

        const second = await rig.blocks.run<string>("new-conversation");
        expect(second).not.toBe(first);
        expect(await rig.blocks.read("current-conversation")).toBe(second);
        await rig.blocks.changes.until((c) => c.includes("current-conversation"), "the current conversation to announce the change");
        expect(await rig.blocks.property("conversation", "title", first)).toBe("first");

        expect(await rig.blocks.run("switch-conversation", { conversation: first })).toBe(first);
        expect(rig.app.conversation.id()).toBe(first);
        await expect(rig.blocks.run("switch-conversation", {})).rejects.toThrow('"Conversation" is required');
        await expect(rig.blocks.property("conversation", "title", "nope")).rejects.toThrow('the agent has no conversation "nope"');
    }, SLOW);

    test("Ask the Agent gives back the answer, never touching the conversation", async () => {
        rig = await appRig();
        expect(await rig.blocks.run("get-answer", { question: "capital of France?" })).toBe("ok: capital of France?");
        expect(rig.app.conversation.history()).toEqual([]);
        expect(rig.host.startedAs(TURN_PROC_ID)).toEqual([]);
        await expect(rig.blocks.run("get-answer", { question: "" })).rejects.toThrow('"Question" is required');
    }, SLOW);
});
