import { afterEach, describe, expect, test } from "bun:test";
import { ACTION_IDS, TRIGGER_IDS } from "../src/contract";
import { TURN_PROC_ID } from "../src/service/conversation";
import { action, appRig, type AppRig } from "./support/app";
import { SLOW } from "./support/host";

let rig: AppRig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

const replies = (r: AppRig) => r.triggers.items.filter((t) => t.id === TRIGGER_IDS.messageReceived);

// The agent's flow actions.
describe("the agent's flow actions", () => {
    test("Switch Conversation, Send Message, Get Answer and When Agent Replies are registered and public", async () => {
        rig = await appRig();
        const defs = rig.app.flowActions();
        expect(defs.map((d) => d.id)).toEqual([ACTION_IDS.switchConversation, ACTION_IDS.sendMessage, ACTION_IDS.getAnswer, TRIGGER_IDS.messageReceived]);
        expect(defs.map((d) => d.name)).toEqual(["Switch Conversation", "Send Message to Agent", "Get Answer from Agent", "When Agent Replies"]);
        for (const d of defs) {
            expect(d.internal).toBeUndefined();
            expect(d.hidden).toBeUndefined();
            expect(d.deprecated).toBeUndefined();
        }
        const event = defs.at(-1)!;
        expect(event.run).toBeUndefined();
        expect(Object.keys(event.outputFields!)).toEqual(["text", "attachments", "messageId", "conversationId", "replyTo"]);
    });

    test("a flow's message is answered with the When Agent Replies payload, and the dropdown follows the conversation", async () => {
        rig = await appRig();
        const id = await action(rig, ACTION_IDS.sendMessage)({ text: "what's up?" });
        await rig.triggers.until((t) => t.length > 0, "the agent's reply");
        const [reply] = replies(rig);
        const entry = rig.app.conversation.history().find((e) => e.kind === "agent")!;
        expect(reply!.payload).toEqual({ text: entry.kind === "agent" ? entry.text : "", attachments: [], messageId: entry.id, conversationId: rig.app.conversation.id(), replyTo: "" });
        expect(rig.app.conversation.history()[0]).toMatchObject({ id, kind: "user", text: "what's up?" });
        // registered again with the conversation in its dropdown
        await rig.app.publish();
        const switcher = rig.registered.filter((d) => d.id === ACTION_IDS.switchConversation).at(-1)!;
        expect(switcher.inputs!.conversation!.options).toEqual([{ label: "what's up?", value: rig.app.conversation.id() }]);
    }, SLOW);

    test("conversation ids stay stable across put-away and reopen", async () => {
        rig = await appRig();
        const send = action(rig, ACTION_IDS.sendMessage);
        const switchTo = action(rig, ACTION_IDS.switchConversation);
        await send({ text: "first" });
        await rig.triggers.until((t) => t.length === 1, "the first reply");
        const first = rig.app.conversation.id();
        const second = await switchTo({ conversation: "" });
        expect(second).not.toBe(first);
        await send({ text: "second" });
        await rig.triggers.until((t) => t.length === 2, "the second reply");
        expect(replies(rig).map((r) => r.payload.conversationId)).toEqual([first, second]);
        expect(await switchTo({ conversation: first })).toBe(first);
        expect(rig.app.conversation.id()).toBe(first);
        expect(await switchTo({ conversation: second })).toBe(second);
        expect(rig.app.conversation.history().filter((e) => e.kind === "user").map((e) => (e as { text: string }).text)).toEqual(["second"]);
    }, SLOW);

    test("a flow's turn has no ask_to_sign_in or show_page tools; the user's does", async () => {
        rig = await appRig();
        await action(rig, ACTION_IDS.sendMessage)({ text: "list your tools [[tools]]" });
        await rig.triggers.until((t) => t.length === 1, "the flow's reply");
        rig.app.conversation.send("list your tools [[tools]]");
        await rig.triggers.until((t) => t.length === 2, "the user's reply");
        const [flow, user] = rig.log().filter((e) => e.event === "tools");
        expect(flow.status).toBe(200);
        expect(flow.tools).not.toContain("ask_to_sign_in");
        expect(flow.tools).not.toContain("show_page");
        expect(flow.tools).toContain("send_message");
        expect(user.tools).toContain("ask_to_sign_in");
        expect(user.tools).toContain("show_page");
    }, SLOW);

    test("Get Answer never touches the conversation, saves no session and uses no MCP server", async () => {
        rig = await appRig();
        const answer = await action(rig, ACTION_IDS.getAnswer)({ question: "capital of France?" });
        expect(answer).toBe("ok: capital of France?");
        expect(rig.app.conversation.history()).toEqual([]);
        expect(rig.entries.items).toEqual([]);
        expect(rig.host.startedAs(TURN_PROC_ID)).toEqual([]);
        const ask = rig.host.started.find((s) => s.id.includes(".ask."))!;
        expect(ask.args).toContain("--ephemeral");
        expect(ask.args.slice(-2)).toEqual(["--", "capital of France?"]);
        expect(ask.args.some((a) => a.startsWith("mcp_servers."))).toBe(false);
        expect(Object.keys(ask.env!)).not.toContain("PAPERBOARD_COMPUTER_MCP_TOKEN");
    }, SLOW);
});
